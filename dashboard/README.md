# Fonds-dashboard · demodata

Åbn `dashboard/index.html` direkte i browseren, eller vælg **Dashboard · demo** i fondsdatabasen. Den selvstændige HTML-fil indeholder hele dashboardet og virker offline.

Bygget med Data Analytics-pluginets build-dashboard- og visualize-data-workflows samt den kanoniske portable renderer. Ingen Google Drive-forbindelse eller andre eksterne datakald.

## Formål og datamodel

Til fonds- og projektteamets overblik over ansøgningsarbejde. 24 deterministiske, fiktive ansøgninger; én række pr. ansøgning. Alle navne, beløb, datoer og statusser er demo. Fast skæringsdato: 13. oktober 2026. Filteret **Indsatsområde** omfatter KPI-kort, begge grafer og begge tabeller.

- Ansøgninger: antal unikke ansøgninger.
- Aktiv pipeline (DKK): ansøgt beløb i Idé, Under udarbejdelse og Indsendt. Ingen sandsynlighedsvægtning.
- Bevilget (DKK): tilsagn, ikke udbetalinger.
- Frister næste 30 dage: endnu ikke indsendte ansøgninger med frist 13. oktober–12. november, begge inklusive.
- Kommende frister-tabellen omfatter også frister efter de 30 dage.

## Visualiseringer

| Spørgsmål | Visualisering | Datagrundlag | Design |
| --- | --- | --- | --- |
| Hvor befinder ansøgningerne sig? | Vandrette statusbjælker | Fem statusgrupper, antal og ansøgt beløb | Nulbaseline, direkte labels, blå palette; øjebliksbillede, ikke konverteringstragt |
| Hvornår er ansøgninger indsendt? | Månedlige søjler | Ti måneder, antal og beløb | Nulbaseline, blå palette; oktober er ufuldstændig |

Indsendte ansøgninger, som senere fik bevilling eller afslag, tæller fortsat i indsendelsesmåneden. Ingen målopfyldelse eller succesrate udledes af de syntetiske data.

## Genbygning

Kræver Node.js og SQLite CLI samt det installerede Data Analytics-plugin ved HTML-pakning.

```bash
npm run dashboard:data
node "$DATA_ANALYTICS_PLUGIN_ROOT/skills/build-report/scripts/deliver_portable_artifact.mjs" --input dashboard/artifact.json --output dashboard/index.html
npm test
```

Sæt `DATA_ANALYTICS_PLUGIN_ROOT` til din installerede pluginmappe. Generatoren opretter `demo-applications.json` og det kanoniske `artifact.json`; HTML er genereret output og må ikke håndredigeres. SQLite-queries er indlejret i kildeproveniensen og beregner alle aggregater ud fra de samme demoposter. Generatoren bruger kun en database i hukommelsen.

## Verifikation

Data Analytics-validering og strukturel HTML-verifikation bestået. 34 tests består; én eksisterende Postgres-integrationstest springes over uden databasekonfiguration. KPI'er, statusgrupper og månedstal afstemmes for alle indsatsområder. Browserbaseret kontrol af grafer, filterbetjening og layout er ikke udført: pluginets verifier fandt ingen kompatibel installeret Chromium. Den genererede semantiske fallback indeholder også diagramdata som tabeller.
