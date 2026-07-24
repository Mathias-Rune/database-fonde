export interface TaxonomyRule {
  category: string;
  keywords: string[];
}

export const focusAreaRules: TaxonomyRule[] = [
  { category: "youth", keywords: ["youth", "young people", "unge", "ungdom", "børn og unge"] },
  { category: "democracy", keywords: ["democracy", "democratic", "demokrati", "demokratisk"] },
  {
    category: "civic_engagement",
    keywords: ["civic", "participation", "engagement", "medborgerskab", "deltagelse", "frivillig"]
  },
  { category: "community", keywords: ["community", "lokalsamfund", "fællesskab", "forening"] },
  {
    category: "social_inclusion",
    keywords: ["inclusion", "inklusion", "social", "marginalized", "udsatte", "fællesskaber"]
  },
  { category: "health", keywords: ["health", "sundhed", "wellbeing", "trivsel"] },
  { category: "mental_health", keywords: ["mental health", "psykisk", "mental sundhed", "ensomhed"] },
  { category: "arts_culture", keywords: ["art", "arts", "culture", "kunst", "kultur", "museum", "musik"] },
  { category: "arts_culture", keywords: ["rytmisk musik"] },
  { category: "education", keywords: ["education", "learning", "school", "uddannelse", "læring", "skole"] },
  { category: "environment", keywords: ["environment", "nature", "miljø", "natur", "biodiversitet"] },
  { category: "climate", keywords: ["climate", "klima", "green transition", "grøn omstilling"] },
  { category: "climate", keywords: ["grøn forandring"] },
  { category: "sports", keywords: ["sport", "sports", "idræt", "motion"] },
  { category: "local_development", keywords: ["local development", "lokal udvikling", "landdistrikter"] },
  { category: "innovation", keywords: ["innovation", "innovative", "nybrud", "udvikling"] },
  { category: "local_development", keywords: ["arbejdsliv"] },
  { category: "entrepreneurship", keywords: ["entrepreneur", "iværksætter", "startup"] },
  { category: "equality", keywords: ["equality", "ligestilling", "diversity", "diversitet"] },
  { category: "vulnerable_groups", keywords: ["vulnerable", "udsatte", "sårbare", "handicap"] }
];

export function normalizeFocusAreas(text: string): string[] {
  const lower = text.toLowerCase();
  return focusAreaRules
    .filter((rule) => rule.keywords.some((keyword) => lower.includes(keyword.toLowerCase())))
    .map((rule) => rule.category);
}
