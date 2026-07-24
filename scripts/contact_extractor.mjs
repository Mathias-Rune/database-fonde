function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#64;", "@")
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function textLines(html) {
  return decodeHtml(html)
    .replaceAll(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article)>/gi, "\n")
    .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => line.replaceAll(/\s+/g, " ").trim())
    .filter(Boolean);
}

function cleanName(value) {
  const name = String(value || "")
    .replace(/^.*\b(?:har du spørgsmål[^?]*\??\s*)?kontakt\s*[:\-–]?\s*/i, "")
    .replace(/^(kontaktperson|contact person|puljekontakt|projektleder|programleder)\s*[:\-–]?\s*/i, "")
    .split(/\s(?:telefon|phone|tlf\.?|e-?mail|mail)\s*[:\-]?/i)[0]
    .replace(/[|,;:]$/, "")
    .trim();
  if (!/^[A-ZÆØÅ][\p{L}'’-]+(?:\s+[A-ZÆØÅ][\p{L}'’-]+){1,4}$/u.test(name)) return "";
  if (/^(Kontakt Os|Læs Mere|Søg Støtte|Apply Now)$/i.test(name)) return "";
  if (/\b(fond(?:en|et)?|forening(?:en)?|kommune|rådhus|fællesråd|sekretariat|afdeling|team|kontor|privatlivspolitik|cookiepolitik)\b/i.test(name)) return "";
  return name;
}

export function extractContact(html, sourceUrl = "") {
  const lines = textLines(html);
  const marker = /\b(kontaktperson|contact person|puljekontakt|projektleder|programleder)\b|^kontakt$/i;
  const emailPattern = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
  const phonePattern = /(?:\+45[\s.-]*)?(?:\d[\s.-]*){8}\b/;

  for (let index = 0; index < lines.length; index += 1) {
    if (!marker.test(lines[index])) continue;
    const nearby = lines.slice(index, index + 5);
    const inlineName = cleanName(lines[index]);
    const followingName = nearby.slice(1).map(cleanName).find(Boolean) || "";
    const contactName = inlineName || followingName;
    if (!contactName) continue;
    const context = nearby.join(" ");
    return {
      contact_name: contactName,
      contact_email: context.match(emailPattern)?.[0] || "",
      contact_phone: context.match(phonePattern)?.[0]?.replaceAll(/\s+/g, " ").trim() || "",
      contact_source_url: sourceUrl,
    };
  }

  return { contact_name: "", contact_email: "", contact_phone: "", contact_source_url: "" };
}
