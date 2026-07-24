import type { CrawlSource, FundedProject } from "../types/domain.js";
import { normalizeFocusAreas } from "../taxonomy/focusAreas.js";
import { excerptAround, firstSentenceish, uniqueStrings } from "../utils/text.js";
import { extractDates, extractMoney } from "./patterns.js";

const projectCue =
  /(funded|supported|awarded|bevilling|bevilget|støttet|uddeling|modtog|received|granted|tildelt)[^.]{0,420}/gi;

export function extractFundedProjects(source: CrawlSource): FundedProject[] {
  if (isProjectDetailUrl(source.sourceUrl)) return dedupeFundedProjects(extractProjectDetailMetadata(source));
  const structuredProjects: FundedProject[] = [
    ...extractLabeledGrantArchiveBlocks(source),
    ...extractStructuredProjectRows(source),
    ...extractPdfProjectContactListRows(source),
    ...extractBevillingBlocks(source),
    ...extractDonationBlocks(source),
    ...extractGrantedAmountBlocks(source),
    ...extractProjectDetailMetadata(source)
  ];
  if (isStructuredProjectListUrl(source.sourceUrl)) return dedupeFundedProjects(structuredProjects);
  const projects: FundedProject[] = [
    ...structuredProjects,
    ...extractDanishMoneyPhraseProjects(source),
    ...extractSupportedWithExamples(source)
  ];
  for (const match of source.text.matchAll(projectCue)) {
    const snippet = excerptAround(source.text, match.index ?? 0, 260);
    if (isApplicationInstruction(snippet)) continue;
    if (isFundingOpportunitySnippet(snippet)) continue;
    if (isNavigationSnippet(snippet)) continue;
    if (isAggregateGrantSnippet(snippet)) continue;
    const money = extractMoney(snippet)[0];
    const year = extractDates(snippet).find((date) => date.year)?.year;
    const name = inferProjectName(snippet);
    const recipient = inferRecipient(snippet);
    if (name && isBadProjectName(name)) continue;
    const normalizedThemes = normalizeFocusAreas(snippet);
    const hasProjectSignal = Boolean(money && (name || recipient));
    if (!hasProjectSignal) continue;
    projects.push({
      projectName: name,
      recipientOrganization: recipient,
      year,
      amount: money?.amount,
      currency: money?.currency,
      description: firstSentenceish(snippet, 500),
      rawThemeLabels: normalizedThemes,
      normalizedThemes,
      targetGroups: extractTargetGroups(snippet),
      geography: extractGeography(snippet),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: confidenceForProject({ money: Boolean(money), year: Boolean(year), name: Boolean(name), recipient: Boolean(recipient) })
    });
  }
  return dedupeFundedProjects(projects);
}

function extractLabeledGrantArchiveBlocks(source: CrawlSource): FundedProject[] {
  const lines = projectLines(source.text);
  const projects: FundedProject[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const recipientMatch = lines[index].match(/^Modtager:\s*(.+)$/i);
    if (!recipientMatch?.[1]) continue;
    const amountLineIndex = lines.slice(index + 1, index + 5).findIndex((line) => /^Beløb:\s*/i.test(line));
    if (amountLineIndex < 0) continue;
    const amountLine = lines[index + 1 + amountLineIndex];
    if (!amountLine || isBadAmountLine(amountLine)) continue;
    const amount = extractMoney(amountLine)[0];
    if (!amount) continue;

    const detailLines = lines.slice(index + 1 + amountLineIndex, index + 10 + amountLineIndex);
    const yearLine = detailLines.find((line) => /^Årstal:\s*20\d{2}$/i.test(line));
    if (!yearLine) continue;
    const year = Number(yearLine.match(/20\d{2}/)?.[0]);
    const rawTheme = detailLines.find((line) => /^Grant category:\s*/i.test(line))?.replace(/^Grant category:\s*/i, "").trim();
    const projectName = findLabeledArchiveProjectName(lines, index);
    const recipientOrganization = inferLabeledArchiveRecipient(recipientMatch[1]);
    if (!projectName || !recipientOrganization) continue;
    if (!looksLikeProjectName(projectName) || !looksLikeOrganization(recipientOrganization)) continue;
    if (isAggregateProjectCandidate(projectName, recipientOrganization, detailLines.join(" "))) continue;

    projects.push({
      projectName,
      recipientOrganization,
      year,
      amount: amount.amount,
      currency: amount.currency,
      description: `${projectName} / ${recipientOrganization} / ${rawTheme ?? ""} / ${amount.raw}`,
      rawThemeLabels: rawTheme ? [rawTheme] : [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(`${projectName} ${recipientOrganization} ${rawTheme ?? ""}`)),
      targetGroups: extractTargetGroups(`${projectName} ${recipientOrganization} ${rawTheme ?? ""}`),
      geography: extractGeography(detailLines.join(" ")),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.9
    });
  }
  return projects;
}

function findLabeledArchiveProjectName(lines: string[], recipientIndex: number): string | undefined {
  return lines
    .slice(Math.max(0, recipientIndex - 8), recipientIndex)
    .reverse()
    .find((line) => looksLikeProjectName(line) && !isProjectArchiveLabel(line));
}

function inferLabeledArchiveRecipient(value: string): string {
  const parts = value.split(",").map((part) => cleanupProjectName(part)).filter(Boolean);
  const institution = [...parts].reverse().find((part) => looksLikeInstitutionName(part));
  return institution ?? cleanupProjectName(value);
}

function extractStructuredProjectRows(source: CrawlSource): FundedProject[] {
  const lines = pdfProjectLines(source.text);
  const projects: FundedProject[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const year = Number(lines[index]);
    if (!/^20\d{2}$/.test(lines[index])) continue;
    const window = lines.slice(index + 1, index + 8);
    const amountIndex = window.findIndex((line) => extractMoney(line).length > 0);
    if (amountIndex < 2) continue;
    if (isBadAmountLine(window[amountIndex])) continue;
    const amount = extractMoney(window[amountIndex])[0];
    if (!amount) continue;
    const variant = inferStructuredRow(window, amountIndex);
    if (!variant) continue;
    const { projectName, recipientOrganization, rawTheme } = variant;
    if (!looksLikeProjectName(projectName) || !looksLikeOrganization(recipientOrganization)) continue;
    if (isAggregateProjectCandidate(projectName, recipientOrganization, window.join(" "))) continue;
    projects.push({
      projectName,
      recipientOrganization,
      year,
      amount: amount.amount,
      currency: amount.currency,
      description: `${projectName} / ${recipientOrganization} / ${rawTheme ?? ""} / ${amount.raw}`,
      rawThemeLabels: rawTheme ? [rawTheme] : [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(rawTheme ?? "")),
      targetGroups: extractTargetGroups(`${projectName} ${recipientOrganization} ${rawTheme ?? ""}`),
      geography: extractGeography(`${projectName} ${recipientOrganization} ${rawTheme ?? ""}`),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.9
    });
  }
  return projects;
}

function extractProjectDetailMetadata(source: CrawlSource): FundedProject[] {
  if (!isProjectDetailUrl(source.sourceUrl)) return [];
  const lines = projectLines(source.text);
  const amount = findLabeledMoney(lines, "Bevilliget");
  if (!amount) return [];
  const yearLine = findLabeledValue(lines, "År");
  const year = yearLine && /^20\d{2}$/.test(yearLine) ? Number(yearLine) : undefined;
  const recipientOrganization = findProjectDetailRecipient(lines);
  const projectName = findProjectDetailName(lines, source.pageTitle);
  if (!recipientOrganization && !projectName) return [];
  return [
    {
      projectName,
      recipientOrganization,
      year,
      amount: amount.amount,
      currency: amount.currency,
      description: [projectName, recipientOrganization, amount.raw].filter(Boolean).join(" / "),
      rawThemeLabels: [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(`${projectName ?? ""} ${recipientOrganization ?? ""}`)),
      targetGroups: extractTargetGroups(`${projectName ?? ""} ${recipientOrganization ?? ""}`),
      geography: extractGeography(source.text),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.88
    }
  ];
}

function extractPdfProjectContactListRows(source: CrawlSource): FundedProject[] {
  if (source.sourceType !== "pdf" || !/projekt-.*kontaktliste|støttede projekter|stoettede projekter/i.test(source.text)) {
    return [];
  }
  const lines = projectLines(source.text);
  const projects: FundedProject[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rowStart = lines[index].match(/^(\d{1,3})\s+([A-ZÆØÅ][A-Za-zÆØÅæøå -]+)$/);
    if (!rowStart) continue;
    const rowEnd = findPdfRowEnd(lines, index + 1);
    const row = lines.slice(index + 1, rowEnd);
    const amountLineIndex = row.findIndex((line) => extractMoney(line).length > 0 && !isBadAmountLine(line));
    if (amountLineIndex < 2) continue;
    const amountLine = row[amountLineIndex];
    const recordEnd = row.findIndex((line, lineIndex) => lineIndex > 1 && isPdfRecordDetailLine(line));
    const titleEnd = recordEnd > 1 ? recordEnd : amountLineIndex;
    const splitFirst = splitPdfRecipientTitleLine(row[0]);
    const recipientParts = [splitFirst.recipient];
    let projectParts = [...(splitFirst.projectLead ? [splitFirst.projectLead] : []), ...row.slice(1, titleEnd)];
    while (projectParts.length > 1 && shouldTreatAsRecipientContinuation(recipientParts, projectParts)) {
      recipientParts.push(projectParts[0]);
      projectParts = projectParts.slice(1);
    }
    const recipientOrganization = cleanupProjectName(recipientParts.join(" "));
    const projectName = cleanupProjectName(projectParts.join(" "));
    if (!recipientOrganization || !projectName) continue;
    if (!looksLikeOrganization(recipientOrganization) || !looksLikeProjectName(projectName)) continue;
    const amount = amountLine ? extractMoney(amountLine)[0] : undefined;
    if (!amount) continue;
    if (isAggregateProjectCandidate(projectName, recipientOrganization, row.join(" "))) continue;
    projects.push({
      projectName,
      recipientOrganization,
      amount: amount.amount,
      currency: amount.currency,
      description: `${projectName} / ${recipientOrganization} / ${amount.raw}`,
      rawThemeLabels: [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(`${projectName} ${recipientOrganization}`)),
      targetGroups: extractTargetGroups(`${projectName} ${recipientOrganization}`),
      geography: extractGeography(row.join(" ")),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.86
    });
  }
  return projects;
}

function findPdfRowEnd(lines: string[], start: number): number {
  const nextRow = lines.slice(start).findIndex((line) => /^\d{1,3}\s+[A-ZÆØÅ][A-Za-zÆØÅæøå -]+$/.test(line));
  return nextRow >= 0 ? start + nextRow : Math.min(lines.length, start + 30);
}

function isPdfRecordDetailLine(line: string): boolean {
  return isPdfDescriptionStart(line) || isPdfAddressOrContactLine(line);
}

function isPdfDescriptionStart(line: string): boolean {
  return /^(projektet|renoveringen|med projektet|formålet|der etableres|der skabes|mødestedet|huset|området|foreningen vil|projektet skal|med renoveringen|tiltaget|initiativet)\b/i.test(
    line
  );
}

function isPdfAddressOrContactLine(line: string): boolean {
  return /@\S+\.\S+|\b\d{8}\b|,\s*\d{4}\s+|^\d{4}\s+| kommune\b|^(side \d+ af \d+|kontakt|telefon|e-mail)\b/i.test(line);
}

function shouldTreatAsRecipientContinuation(recipientParts: string[], projectParts: string[]): boolean {
  const recipient = recipientParts.join(" ");
  const nextLine = projectParts[0];
  const followingLine = projectParts[1];
  if (!nextLine || !followingLine) return false;
  if (/,\s*$/.test(recipient)) return true;
  if (/^(foreningen|fonden|s\/i|den selvejende institution|døveforeningen)$/i.test(recipient)) return true;
  if (isDanishRegionLine(nextLine) && looksLikeProjectName(followingLine)) return true;
  if (/^[A-ZÆØÅ0-9 .()/-]{4,}$/.test(nextLine) && /[a-zæøå]/.test(followingLine)) return true;
  if (/(spejderkorps|forening|kommune|skole|museum|center|fond|klub|råd|laug|hallen|forsamlingshus|borgerforening|idrætsforening)/i.test(nextLine)) {
    return true;
  }
  return false;
}

function splitPdfRecipientTitleLine(line: string): { recipient: string; projectLead?: string } {
  const split = line.match(/^(S\/I\s+[A-ZÆØÅ0-9 .'-]{3,}?)\s+([A-ZÆØÅ][a-zæøå].+)$/);
  if (split?.[1] && split[2]) return { recipient: split[1].trim(), projectLead: split[2].trim() };
  return { recipient: line };
}

function isDanishRegionLine(line: string): boolean {
  return /^(hovedstaden|sjælland|syddanmark|midtjylland|nordjylland|bornholm)$/i.test(line);
}

function extractBevillingBlocks(source: CrawlSource): FundedProject[] {
  const lines = projectLines(source.text);
  const projects: FundedProject[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^bevilling$/i.test(lines[index])) continue;
    const amountLineIndex = lines.slice(index + 1, index + 4).findIndex((line) => extractMoney(line).length > 0);
    if (amountLineIndex < 0) continue;
    const amountLine = lines[index + 1 + amountLineIndex];
    if (!amountLine || isBadAmountLine(amountLine)) continue;
    const amount = extractMoney(amountLine)[0];
    if (!amount) continue;
    const afterAmount = lines.slice(index + 2 + amountLineIndex, index + 9 + amountLineIndex);
    const yearIndex = afterAmount.findIndex((line) => /^20\d{2}$/.test(line));
    if (yearIndex < 0) continue;
    const year = Number(afterAmount[yearIndex]);
    const recipientOrganization = afterAmount[yearIndex + 1];
    const projectName = afterAmount[yearIndex + 2];
    const rawTheme = findPreviousTheme(lines, index);
    if (!projectName || !recipientOrganization) continue;
    if (!looksLikeProjectName(projectName) || !looksLikeOrganization(recipientOrganization)) continue;
    if (isAggregateProjectCandidate(projectName, recipientOrganization, afterAmount.join(" "))) continue;
    projects.push({
      projectName,
      recipientOrganization,
      year,
      amount: amount.amount,
      currency: amount.currency,
      description: `${projectName} / ${recipientOrganization} / ${rawTheme ?? ""} / ${amount.raw}`,
      rawThemeLabels: rawTheme ? [rawTheme] : [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(rawTheme ?? "")),
      targetGroups: extractTargetGroups(`${projectName} ${recipientOrganization} ${rawTheme ?? ""}`),
      geography: extractGeography(`${projectName} ${recipientOrganization} ${rawTheme ?? ""}`),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.9
    });
  }
  return projects;
}

function extractDonationBlocks(source: CrawlSource): FundedProject[] {
  const lines = projectLines(source.text);
  const projects: FundedProject[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^Tildelt støtte$/i.test(lines[index])) continue;
    const amountLine = lines.slice(index + 1, index + 4).find((line) => extractMoney(line).length > 0);
    const yearLine = lines.slice(index + 1, index + 6).find((line) => /^20\d{2}$/.test(line));
    if (amountLine && isBadAmountLine(amountLine)) continue;
    const amount = amountLine ? extractMoney(amountLine)[0] : undefined;
    const year = yearLine ? Number(yearLine) : undefined;
    const previous = lines.slice(Math.max(0, index - 8), index).filter((line) => !isDonationLabel(line));
    const recipientOrganization = previous.at(-1);
    const projectName = previous.at(-2);
    if (!amount || !projectName || !recipientOrganization) continue;
    if (!looksLikeProjectName(projectName) || !looksLikeOrganization(recipientOrganization)) continue;
    if (isAggregateProjectCandidate(projectName, recipientOrganization, previous.join(" "))) continue;
    projects.push({
      projectName,
      recipientOrganization,
      year,
      amount: amount.amount,
      currency: amount.currency,
      description: `${projectName} / ${recipientOrganization} / ${amount.raw}`,
      rawThemeLabels: [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(`${projectName} ${recipientOrganization}`)),
      targetGroups: extractTargetGroups(`${projectName} ${recipientOrganization}`),
      geography: extractGeography(`${projectName} ${recipientOrganization}`),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.9
    });
  }
  return projects;
}

function extractGrantedAmountBlocks(source: CrawlSource): FundedProject[] {
  const lines = projectLines(source.text);
  const projects: FundedProject[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^granted amount:?$/i.test(lines[index])) continue;
    const amountLine = lines.slice(index + 1, index + 4).find((line) => extractMoney(line).length > 0);
    if (!amountLine || isBadAmountLine(amountLine)) continue;
    const amount = extractMoney(amountLine)[0];
    if (!amount) continue;
    const previous = lines.slice(Math.max(0, index - 6), index).filter((line) => !isProjectCardLabel(line));
    const projectName = previous.reverse().find((line) => looksLikeProjectName(line) && !looksLikeProgrammeLabel(line));
    const rawTheme = previous.find((line) => looksLikeProgrammeLabel(line));
    if (!projectName) continue;
    if (isAggregateProjectCandidate(projectName, undefined, previous.join(" "))) continue;
    projects.push({
      projectName: cleanupProjectName(projectName),
      amount: amount.amount,
      currency: amount.currency,
      description: [projectName, rawTheme, amount.raw].filter(Boolean).join(" / "),
      rawThemeLabels: rawTheme ? [rawTheme] : [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(`${projectName} ${rawTheme ?? ""}`)),
      targetGroups: extractTargetGroups(`${projectName} ${rawTheme ?? ""}`),
      geography: extractGeography(`${projectName} ${rawTheme ?? ""}`),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.9
    });
  }
  return projects;
}

function extractDanishMoneyPhraseProjects(source: CrawlSource): FundedProject[] {
  const projects: FundedProject[] = [];
  const patterns = [
    /([A-ZÆØÅ][^.\n]{4,140}?)\s+(?:er\s+)?støttet med\s+([^.\n]{1,60})/gi,
    /([A-ZÆØÅ][^.\n]{4,140}?)\s+har modtaget\s+([^.\n]{1,60})/gi,
    /([A-ZÆØÅ][^.\n]{4,140}?)\s+(?:fik|får)\s+(?:en\s+)?(?:bevilling|donation|støtte)\s+på\s+([^.\n]{1,60})/gi,
    /(?:bevilling|donation|støtte)\s+på\s+([^.\n]{1,60})\s+til\s+([A-ZÆØÅ][^.\n]{4,140})/gi
  ];
  for (const pattern of patterns) {
    for (const match of source.text.matchAll(pattern)) {
      const phraseFirst = /^(?:bevilling|donation|støtte)/i.test(match[0]);
      const projectName = (phraseFirst ? match[2] : match[1])?.trim();
      const moneyText = phraseFirst ? match[1] : match[2];
      const amount = extractMoney(moneyText ?? "")[0];
      if (!amount || !projectName || isBadProjectName(projectName)) continue;
      const snippet = excerptAround(source.text, match.index ?? 0, 240);
      if (isApplicationInstruction(snippet) || isFundingOpportunitySnippet(snippet) || isNavigationSnippet(snippet) || isAggregateGrantSnippet(snippet)) continue;
      if (isAggregateProjectCandidate(projectName, undefined, snippet)) continue;
      projects.push({
        projectName: cleanupProjectName(projectName),
        recipientOrganization: inferRecipient(snippet),
        year: extractDates(snippet).find((date) => date.year)?.year,
        amount: amount.amount,
        currency: amount.currency,
        description: firstSentenceish(snippet, 420),
        rawThemeLabels: [],
        normalizedThemes: uniqueStrings(normalizeFocusAreas(snippet)),
        targetGroups: extractTargetGroups(snippet),
        geography: extractGeography(snippet),
        sourceUrl: source.sourceUrl,
        sourceId: source.id,
        confidence: 0.76
      });
    }
  }
  return projects;
}

function extractSupportedWithExamples(source: CrawlSource): FundedProject[] {
  const projects: FundedProject[] = [];
  const pattern = /([A-ZÆØÅ][^()\n]{4,120})\s+\(støttet med ([^)]+)\)/gi;
  for (const match of source.text.matchAll(pattern)) {
    const amount = extractMoney(match[2])[0];
    const projectName = cleanupProjectName(match[1]?.trim() ?? "");
    if (!amount || !projectName || isBadProjectName(projectName)) continue;
    const snippet = excerptAround(source.text, match.index ?? 0, 220);
    if (isAggregateGrantSnippet(snippet) || isApplicationInstruction(snippet) || isFundingOpportunitySnippet(snippet)) continue;
    if (isAggregateProjectCandidate(projectName, undefined, snippet)) continue;
    projects.push({
      projectName,
      year: extractDates(snippet).find((date) => date.year)?.year,
      amount: amount.amount,
      currency: amount.currency,
      description: `${projectName} / ${amount.raw}`,
      rawThemeLabels: [],
      normalizedThemes: uniqueStrings(normalizeFocusAreas(snippet)),
      targetGroups: extractTargetGroups(snippet),
      geography: extractGeography(snippet),
      sourceUrl: source.sourceUrl,
      sourceId: source.id,
      confidence: 0.82
    });
  }
  return projects;
}

function inferStructuredRow(
  window: string[],
  amountIndex: number
): { projectName: string; recipientOrganization: string; rawTheme?: string } | undefined {
  const allGrantsRow = inferAllGrantsTableRow(window, amountIndex);
  if (allGrantsRow) return allGrantsRow;

  // Common table order: year, project, organization, theme, pool, amount.
  if (amountIndex >= 3) {
    const [projectName, recipientOrganization, rawTheme] = window;
    if (looksLikeProjectName(projectName) && looksLikeOrganization(recipientOrganization)) {
      return { projectName, recipientOrganization, rawTheme };
    }
  }
  // Common article/list order: year, recipient, project, amount, theme.
  if (amountIndex >= 2) {
    const recipientOrganization = window[0];
    const projectName = window[1];
    const rawTheme = window[amountIndex + 1];
    if (looksLikeProjectName(projectName) && looksLikeOrganization(recipientOrganization)) {
      return { projectName, recipientOrganization, rawTheme };
    }
  }
  return undefined;
}

function inferAllGrantsTableRow(
  window: string[],
  amountIndex: number
): { projectName: string; recipientOrganization: string; rawTheme?: string } | undefined {
  if (amountIndex < 4) return undefined;
  const [category, applicant, institution, projectName] = window;
  if (!looksLikeGrantCategory(category) || !looksLikeProjectName(projectName)) return undefined;
  const recipientOrganization = looksLikeInstitutionName(institution) ? institution : applicant;
  if (!looksLikeOrganization(recipientOrganization)) return undefined;
  return { projectName, recipientOrganization, rawTheme: category };
}

function projectLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 180)
    .filter((line) => !isNavigationLine(line));
}

function pdfProjectLines(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 700)
    .filter((line) => !isNavigationLine(line));
}

function findPreviousTheme(lines: string[], index: number): string | undefined {
  const previous = lines.slice(Math.max(0, index - 4), index).reverse();
  return previous.find((line) => !/^støtteområde$/i.test(line) && !isDonationLabel(line));
}

function findLabeledValue(lines: string[], label: string): string | undefined {
  const index = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  return index >= 0 ? lines[index + 1] : undefined;
}

function findLabeledMoney(lines: string[], label: string) {
  const value = findLabeledValue(lines, label);
  return value ? extractMoney(value)[0] : undefined;
}

function findProjectDetailRecipient(lines: string[]): string | undefined {
  const recipientIndex = lines.findIndex((line) => /^modtager$/i.test(line));
  const projectNumberIndex = lines.findIndex((line, index) => index > recipientIndex && /^projektnummer:?$/i.test(line));
  if (recipientIndex < 0 || projectNumberIndex < 0) return undefined;
  const candidates = lines.slice(recipientIndex + 1, projectNumberIndex).filter((line) => looksLikeOrganization(line));
  return candidates.at(-1);
}

function findProjectDetailName(lines: string[], pageTitle?: string): string | undefined {
  const sectionIndex = lines.findIndex((line) => /det har vi støttet/i.test(line));
  const relatedIndex = lines.findIndex((line, index) => index > sectionIndex && /^andre projekter$/i.test(line));
  const fromBreadcrumb =
    sectionIndex >= 0 && relatedIndex > sectionIndex
      ? lines
          .slice(sectionIndex + 1, relatedIndex)
          .reverse()
          .find((line) => looksLikeProjectName(line))
      : undefined;
  if (fromBreadcrumb) return cleanupProjectName(fromBreadcrumb);
  const title = pageTitle?.replace(/\s[|-].*$/, "").trim();
  return title && looksLikeProjectName(title) ? cleanupProjectName(title) : undefined;
}

function inferProjectName(snippet: string): string | undefined {
  const supported = snippet.match(/(?:\n|^)([A-ZÆØÅ][A-Za-zÆØÅæøå0-9 &'().–-]{3,100})\s+er støttet/i)?.[1];
  if (supported) return supported.trim();
  const quoted = snippet.match(/[“"']([^“"']{4,100})[”"']/)?.[1];
  if (quoted) return quoted.trim();
  const projectLabel = snippet.match(/(?:project|projekt)\s+([A-ZÆØÅ][^.,\n]{3,90})/i)?.[1];
  return projectLabel?.trim();
}

function isApplicationInstruction(snippet: string): boolean {
  return /(i kan søge|for at søge|ansøgning|ansøgningsskema|projektidé|behandlingstid|send en projektidé|proces for ansøgning|sådan vurderer vi|støtte over \d|støtte på over|materialer til .*projekter|når i har modtaget støtte|udbetaling af støtte|kommunikationsplan|hurtig vurdering|apply for|how to apply|application|application guide|application deadline|applicants?|eligib(?:le|ility)|guidelines|budget template|reporting|terms and conditions)/i.test(
    snippet
  );
}

function isFundingOpportunitySnippet(snippet: string): boolean {
  return /(open calls?|current calls?|call for|competition for|apply here|apply now|next deadline|deadline for submissions|maximum application amount|you may apply|may apply for|can apply for|we welcome applications|grants? are awarded for|awarded for a .*period|allocated to this call|indicative amount|project supplement|indirect costs|all calls close)/i.test(
    snippet
  );
}

function isNavigationSnippet(snippet: string): boolean {
  const navHits = [
    "Søg støtte",
    "Det har vi støttet",
    "Alle uddelinger",
    "Projekteksempler",
    "Når I har modtaget støtte",
    "Det støtter vi ikke"
  ].filter((needle) => snippet.includes(needle)).length;
  return navHits >= 3;
}

function isAggregateGrantSnippet(snippet: string): boolean {
  return /(samlet:|samlet bevilling|samlet pulje|samlet beløb|samlet støtte|total amount|combined funding|up to\s+(?:DKK|kr\.?|€|EUR|USD|\$)?\s*\d|op til\s+\d|further approximately|konsortium|consortium|femårig fase|five-year phase|\b\d+\s+(projekter|forskningsprojekter|udstillingssteder|virksomheder|kommuner|universities|universiteter)\s+(får|fik|modtager|har fået|join forces)|\b\d+\s+(projekter|forskningsprojekter|udstillingssteder|virksomheder|kommuner|universities|universiteter)\b|pulje på|samlet ramme|i alt\s+\d)/i.test(
    snippet
  );
}

function isDonationLabel(line: string): boolean {
  return /^(donation|projekt|voksne|børn og unge|born og unge|særpulje|saerpulje|-|tildelt støtte)$/i.test(line);
}

function isProjectCardLabel(line: string): boolean {
  return /^(related projects|granted amount:?|learn more|læs mere)$/i.test(line);
}

function isProjectArchiveLabel(line: string): boolean {
  return /^(forside|home|filtrér|filtrer|kategori:|alle kategorier|news|nyheder|press release|årstal:|alle år|søg|grant category:.+|lande:.+)$/i.test(
    line
  );
}

function looksLikeProgrammeLabel(line: string): boolean {
  return /(initiative|programme|program|grant|fellowship|pulje|indsats)$/i.test(line);
}

function looksLikeGrantCategory(line: string): boolean {
  return /(postdocs?|professorship|fellowship|investigator|scholarship|experiment|frontier|neurotorium|brain prize|talent prize|programme|program|project|conference|sabbatical|clinician|strategic|medical professionals|scientific enrichment)/i.test(
    line
  );
}

function looksLikeInstitutionName(line: string): boolean {
  if (!looksLikeOrganization(line)) return false;
  if (/^(professor|associate professor|clinical professor|researcher|head of department|phd|md|doctor|consultant)$/i.test(line)) return false;
  return /(university|universitet|hospital|institute|institution|school|college|center|centre|rigshospitalet|salk institute|cbs|ku|au|dtu|sdu)/i.test(
    line
  );
}

function isNavigationLine(line: string): boolean {
  return /^(menu|søg støtte|ansøg om støtte|se projekter|nyheder|om fonden|kontakt|læs mere|se alle|gå til hovedindhold|servicemenu|brødkrumme|del|udskriv siden)$/i.test(
    line
  );
}

function isBadAmountLine(line: string): boolean {
  return /samlet:|støtte over|støtte på over|op til|fra\s+\d|pulje på|samlet pulje|samlet ramme|up to|maximum application amount|allocated to this call|total amount|indicative amount/i.test(line);
}

function isStructuredProjectListUrl(url: string): boolean {
  return /st(o|oe|ø)ttede-projekter|det-har-vi-stoettet|\/grant-category\//.test(url);
}

function isProjectDetailUrl(url: string): boolean {
  return /\/project\//i.test(url);
}

function looksLikeProjectName(value: string): boolean {
  return value.length >= 4 && !isBadProjectName(value) && !isNavigationLine(value);
}

function looksLikeOrganization(value: string): boolean {
  return value.length >= 3 && !isNavigationLine(value) && !/^(projekt|organisation|indsatsområde|støtteområde|pulje|beløb|bevilling)$/i.test(value);
}

function isBadProjectName(value: string): boolean {
  const normalized = value.trim();
  if (/^(projekt|organisation|indsatsområde|støtteområde|pulje|beløb|bevilling|dato|alle projekter|vis flere|menu|støtte over .+|få en hurtig vurdering)$/i.test(normalized)) {
    return true;
  }
  return /(støttede projekter|stoettede-projekter|pulje-projekter|projekt- og kontaktliste|ansøgere|ansøgning|nyhedsbrev)/i.test(normalized);
}

function isAggregateProjectCandidate(projectName?: string, recipientOrganization?: string, context = ""): boolean {
  const text = [projectName, recipientOrganization, context].filter(Boolean).join(" ");
  if (isAggregateGrantSnippet(text)) return true;
  if (/\b\d+\s+(projekter|forskningsprojekter|udstillingssteder|virksomheder|kommuner)\b/i.test(text)) return true;
  if (/^(flere|alle|udvalgte|støttede)\s+/i.test(projectName ?? "")) return true;
  return false;
}

function cleanupProjectName(value: string): string {
  return value.replace(/^(?:og\s+)?(?:projektet|initiativet)\s+/i, "").replace(/\s+/g, " ").trim();
}

function inferRecipient(snippet: string): string | undefined {
  const patterns = [
    /(?:to|til|recipient|modtager)\s+([A-ZÆØÅ][A-Za-zÆØÅæøå0-9 &'().-]{3,90})/,
    /([A-ZÆØÅ][A-Za-zÆØÅæøå0-9 &'().-]{3,90})\s+(?:received|modtog|fik|has been awarded)/
  ];
  for (const pattern of patterns) {
    const match = snippet.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function extractTargetGroups(snippet: string): string[] {
  const groups = [
    ["young people", "youth"],
    ["unge", "youth"],
    ["children", "children"],
    ["børn", "children"],
    ["vulnerable", "vulnerable_groups"],
    ["udsatte", "vulnerable_groups"]
  ];
  const lower = snippet.toLowerCase();
  return uniqueStrings(groups.filter(([keyword]) => lower.includes(keyword)).map(([, group]) => group));
}

function extractGeography(snippet: string): string[] {
  const locations = ["copenhagen", "københavn", "denmark", "danmark", "greenland", "grønland"];
  const lower = snippet.toLowerCase();
  return uniqueStrings(locations.filter((location) => lower.includes(location)));
}

function confidenceForProject(signals: { money: boolean; year: boolean; name: boolean; recipient: boolean }): number {
  let confidence = 0.35;
  if (signals.money) confidence += 0.2;
  if (signals.year) confidence += 0.15;
  if (signals.name) confidence += 0.15;
  if (signals.recipient) confidence += 0.15;
  return Math.min(confidence, 0.9);
}

export function dedupeFundedProjects(projects: FundedProject[]): FundedProject[] {
  const sorted = [...projects].sort((a, b) => projectQuality(b) - projectQuality(a));
  const seen = new Set<string>();
  const seenIdentity = new Set<string>();
  const seenNamedAmountSource = new Set<string>();
  const seenUnnamedAmountSource = new Set<string>();
  return sorted.filter((project) => {
    const exactKey = [project.projectName, project.recipientOrganization, project.year, project.amount, project.sourceUrl].join("|");
    const identityKey = projectIdentityKey(project);
    const amountSourceKey = project.amount ? [project.sourceUrl, project.amount, project.currency].join("|") : undefined;
    if (seen.has(exactKey)) return false;
    if (identityKey && seenIdentity.has(identityKey)) return false;
    if (amountSourceKey && !project.projectName && (seenNamedAmountSource.has(amountSourceKey) || seenUnnamedAmountSource.has(amountSourceKey))) return false;
    seen.add(exactKey);
    if (identityKey) seenIdentity.add(identityKey);
    if (amountSourceKey && project.projectName) seenNamedAmountSource.add(amountSourceKey);
    if (amountSourceKey && !project.projectName) seenUnnamedAmountSource.add(amountSourceKey);
    return true;
  });
}

function projectIdentityKey(project: FundedProject): string | undefined {
  if (!project.projectName && !project.recipientOrganization) return undefined;
  return [
    normalizeProjectIdentity(project.projectName),
    normalizeProjectIdentity(project.recipientOrganization),
    project.year ?? "",
    project.amount ?? "",
    project.currency ?? ""
  ].join("|");
}

function normalizeProjectIdentity(value?: string): string {
  return value?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

function projectQuality(project: FundedProject): number {
  let score = project.confidence;
  if (project.recipientOrganization) score += 0.2;
  if (project.year) score += 0.1;
  if (project.projectName && /^[A-ZÆØÅ]/.test(project.projectName)) score += 0.15;
  if (!project.projectName) score -= 0.12;
  if (project.projectName && /^(skal|kan|vil|er|har)\b/i.test(project.projectName)) score -= 0.3;
  if (project.description?.includes("RelateredeArtikler")) score -= 0.2;
  return score;
}
