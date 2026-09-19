// ============================================================================
// Railway Infrastructure as Code
// ============================================================================
//
// Loest die `railway.toml` (Config as Code) ab. Railway liest railway.toml /
// railway.json nur noch bis zum 01.12.2026 — danach ist diese Datei die
// einzige Quelle der Wahrheit fuer die Railway-Services.
//
// HERKUNFT: `railway config pull` gegen das Projekt `alles-neue-tools`,
// Environment `production`, am 19.09.2026. Die Werte sind also aus Railway
// gelesen, nicht abgeleitet. Zwei bewusste Abweichungen vom damaligen
// Ist-Zustand, beide bei `google-maps-hoi-an`: die Cron-Zeit (angewendet) und
// das `--city hoi-an` im Startbefehl (siehe dort).
//
// Anwenden (aus dem Verzeichnis, das mit dem Railway-Projekt verknuepft ist):
//
//   railway config plan     # zeigt den Diff gegen die LIVE-Umgebung, aendert nichts
//   railway config apply    # wendet ihn an, fragt vor destruktiven Schritten nach
//
// STAND 19.09.2026: `apply` ist gelaufen. `railway config plan` meldet
// „Your Railway configuration is already up to date" — Datei und Live-Umgebung
// sind deckungsgleich. Zeigt `plan` kuenftig einen Diff, wurde entweder hier
// oder in Railway von Hand verstellt. Das gehoert geklaert, bevor `apply`
// wieder laeuft.

import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const allesNeueTools = github("smrk-ai/alles-neue-tools", { checkSuites: false });

  // Alle fuenf Services laufen in derselben Region mit einer Replica. Es sind
  // Einmal-Jobs: `restartPolicyType: NEVER`, weil ein Neustart den Lauf
  // doppelt ausfuehren wuerde.
  const replicas = { "europe-west4-drams3a": 1 } as const;

  // Secrets bleiben in Railway. `preserve()` haelt den Wert fest, den Railway
  // schon hat: `apply` kann ihn weder ueberschreiben noch loeschen, und er
  // taucht in keiner Plan-Ausgabe und keinem CI-Log auf. Das gilt hier auch
  // fuer die TOOL_*-Variablen — sie sind keine Geheimnisse, werden aber
  // bewusst im Dashboard gepflegt und nicht aus dem Repo gesetzt.
  const secrets = {
    PIPELINE_API_KEY: preserve(),
    PIPELINE_API_URL: preserve(),
    SUPABASE_SERVICE_ROLE_KEY: preserve(),
    SUPABASE_URL: preserve(),
    TOOL_API_KEY: preserve(),
    TOOL_RUNS_API_URL: preserve(),
    TOOL_SLUG: preserve(),
  } as const;

  // Der einzige Service im Regelbetrieb.
  //
  // `--city hoi-an` MUSS im Startbefehl stehen. Ohne das Flag faellt
  // `run-tool.ts` auf `--city all` zurueck (Zeile 91) und bildet daraus den
  // Config-Slug `google-maps` statt `google-maps-hoi-an` (Zeile 115). In
  // `tool_configs` steht `google-maps` auf is_active=false — der Lauf steigt
  // dann mit Exit 0 aus, ohne Fehler und ohne `tool_runs`-Eintrag. Der Deploy
  // waere gruen und das Tool trotzdem tot.
  //
  // Bis zum 18.09.2026 hat `entrypoint.sh` das Flag aus `TOOL_CITY` angehaengt.
  // Der IaC-Startbefehl umgeht `entrypoint.sh`, also muss es hier stehen.
  // `TOOL_CITY` wird von `src/` nirgends gelesen und ist damit nur noch
  // Dokumentation.
  //
  // Cron: Railway wertet in UTC aus. Umrechnung ICT (UTC+7, keine Sommerzeit):
  //   Mo 06:00 ICT = So 23:00 UTC   (cron-Wochentag 0)
  //   Mi 06:00 ICT = Di 23:00 UTC   (2)
  //   Fr 06:00 ICT = Do 23:00 UTC   (4)
  // Der Wochentag rutscht einen zurueck, weil 06:00 minus 7 Stunden ueber
  // Mitternacht faellt. Nur die Stunde umzurechnen und `1,3,5` stehen zu
  // lassen, waere um genau einen Tag daneben.
  const googleMapsHoiAn = service("google-maps-hoi-an", {
    source: allesNeueTools,
    start: "npm run run-tool -- --slug google-maps --city hoi-an",
    replicas,
    deploy: { cronSchedule: "0 23 * * 0,2,4", restartPolicyType: "NEVER" },
    networking: { privateNetworkEndpoint: "google-maps" },
    env: { ...secrets, GOOGLE_PLACES_API_KEY: preserve(), TOOL_CITY: preserve(), TOOL_ENV: preserve() },
  });

  // Ab hier: in `tool_configs` auf is_active=false. Die Services stehen in
  // Railway samt Cron, der Lauf steigt aber in `run-tool.ts` sofort mit
  // Exit 0 aus. Cron-Zeiten und Variablen sind der gelesene Ist-Zustand.
  const osmMonitor = service("osm-monitor", {
    source: allesNeueTools,
    start: "npm run run-tool -- --slug osm-monitor",
    replicas,
    deploy: { cronSchedule: "0 22 * * *", restartPolicyType: "NEVER" },
    env: { ...secrets, GOOGLE_PLACES_API_KEY: preserve() },
  });

  const sitemapMiner = service("sitemap-miner", {
    source: allesNeueTools,
    start: "npm run run-tool -- --slug sitemap-miner",
    replicas,
    deploy: { cronSchedule: "0 18 * * *", restartPolicyType: "NEVER" },
    env: { ...secrets, TOOL_ENV: preserve() },
  });

  const googleAlerts = service("google-alerts", {
    source: allesNeueTools,
    start: "npm run run-tool -- --slug google-alerts",
    replicas,
    deploy: { cronSchedule: "0 18 * * *", restartPolicyType: "NEVER" },
    env: { ...secrets, TOOL_ENV: preserve() },
  });

  // Ohne Cron — der Service kann nur von Hand bzw. ueber die Railway-API
  // ("Run Now" im Admin) gestartet werden. Das ist der gelesene Ist-Zustand,
  // keine Auslassung.
  const changedetection = service("changedetection", {
    source: allesNeueTools,
    start: "npm run run-tool -- --slug changedetection",
    replicas,
    deploy: { restartPolicyType: "NEVER" },
    env: { ...secrets, TOOL_ENV: preserve() },
  });

  return project("alles-neue-tools", {
    resources: [googleMapsHoiAn, osmMonitor, sitemapMiner, googleAlerts, changedetection],
  });
});
