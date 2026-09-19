// ============================================================================
// Railway Infrastructure as Code
// ============================================================================
//
// Loest die `railway.toml` (Config as Code) ab. Railway liest railway.toml /
// railway.json nur noch bis zum 01.12.2026 — danach ist diese Datei die
// einzige Quelle der Wahrheit fuer die Railway-Services.
//
// Anwenden (aus dem Verzeichnis, das mit dem Railway-Projekt verknuepft ist):
//
//   railway config plan     # zeigt den Diff gegen die LIVE-Umgebung, aendert nichts
//   railway config apply    # wendet ihn an, fragt vor destruktiven Schritten nach
//
// Braucht Railway CLI >= 5.42.1. Vor dem ersten `apply` muessen die Services in
// Railway von Config as Code auf IaC umgestellt werden — siehe RAILWAY.md.
//
// WICHTIG: `plan` ist Pflicht, nicht Kuer. Die Cron-Zeiten und Env-Variablen
// unten sind aus der Lauf-Historie in Supabase und aus `entrypoint.sh`
// rekonstruiert, weil die Railway-API beim Schreiben dieser Datei nicht
// erreichbar war. Der Plan-Diff ist der Abgleich mit der Realitaet.
//
// Erwartet wird dabei GENAU EINE Aenderung: die Cron-Zeit von
// `google-maps-hoi-an` (Umstellung auf 06:00 vietnamesische Zeit, siehe dort).
// Alles andere im Diff ist ungeplant — dann ist entweder diese Datei falsch
// oder in Railway wurde von Hand verstellt. Beides gehoert geklaert, bevor
// `apply` laeuft.

import { defineRailway, github, preserve, project, service } from 'railway/iac';

const REPO = 'smrk-ai/alles-neue-tools';

/**
 * Secrets bleiben in Railway. `preserve()` haelt den Wert fest, den Railway
 * schon hat: `apply` kann ihn weder ueberschreiben noch loeschen, und er
 * taucht in keiner Plan-Ausgabe und keinem CI-Log auf.
 *
 * Gesetzt werden die Werte weiterhin im Railway-Dashboard bzw. als Shared
 * Variables des Projekts — nicht hier und nicht im Repo.
 */
const SECRETS = {
  PIPELINE_API_URL: preserve(),
  PIPELINE_API_KEY: preserve(),
  TOOL_RUNS_API_URL: preserve(),
  TOOL_API_KEY: preserve(),
  SUPABASE_URL: preserve(),
  SUPABASE_SERVICE_ROLE_KEY: preserve(),
  GOOGLE_PLACES_API_KEY: preserve(),
} as const;

interface ToolService {
  /** Name des Railway-Service. Entspricht dem Slug in `tool_configs`. */
  name: string;
  /**
   * Wert fuer TOOL_SLUG — der BASIS-Slug, nicht der Service-Name.
   *
   * `run-tool.ts` setzt den Config-Slug selbst aus `--slug` + `--city`
   * zusammen (`google-maps` + `hoi-an` -> `google-maps-hoi-an`) und kennt in
   * `loadToolFactory()` nur die Basis-Slugs. TOOL_SLUG auf den Service-Namen
   * zu setzen, laesst den Lauf mit "Unknown tool slug" sterben.
   */
  slug: string;
  /** TOOL_CITY. Default `all`. */
  city?: string;
  /** TOOL_MODE — nur `baseline_only` oder `dry_run`, sonst weglassen. */
  mode?: 'baseline_only' | 'dry_run';
  /** Cron in UTC. Railway rechnet keine Zeitzonen um. */
  cron: string;
  /**
   * Build-Backend. Default `NIXPACKS` — bewusst, siehe DEFAULT_BUILDER.
   * Pro Service umschaltbar, damit der Railpack-Umstieg einen Service nach
   * dem anderen nehmen kann statt alle fuenf auf einmal.
   */
  builder?: 'NIXPACKS' | 'RAILPACK';
}

/**
 * Diese Migration tauscht das Config-Format, nicht den Builder. Der Wechsel
 * auf Railpack (Nixpacks-Nachfolger) ist ein eigener Schritt mit eigenem
 * Deploy — sonst ist bei einem roten Build nicht zu unterscheiden, welche der
 * beiden Aenderungen ihn gebrochen hat.
 *
 * Achtung beim Umstellen: Railpack loest `engines.node` anders auf als
 * Nixpacks (es reicht die Range woertlich an mise weiter). Der Plan dazu,
 * inklusive Kanarienvogel-Service und Abbruchkriterium, steht in RAILWAY.md.
 */
const DEFAULT_BUILDER = 'NIXPACKS' as const;

function tool({ name, slug, city = 'all', mode, cron, builder = DEFAULT_BUILDER }: ToolService) {
  return service(name, {
    source: github(REPO),
    build: { builder },
    deploy: {
      startCommand: 'bash entrypoint.sh',
      // Einmal-Jobs: ein Neustart wuerde den Lauf doppelt ausfuehren.
      restartPolicyType: 'NEVER',
      cronSchedule: cron,
    },
    env: {
      TOOL_SLUG: slug,
      TOOL_CITY: city,
      ...(mode ? { TOOL_MODE: mode } : {}),
      TOOL_ENV: 'production',
      ...SECRETS,
    },
  });
}

export default defineRailway(() => {
  const tools = [
    // Der einzige Service im Regelbetrieb.
    //
    // ACHTUNG — das ist die eine Stelle, an der diese Datei bewusst NICHT den
    // Ist-Zustand abbildet: Railway feuert heute `0 22 * * 1,3,5`, also
    // Di/Do/Sa 05:00 vietnamesischer Zeit. Gewollt sind Mo/Mi/Fr 06:00 ICT.
    // Der `plan`-Diff zeigt diese Zeile deshalb als Aenderung — sie ist
    // beabsichtigt, im Gegensatz zu allem anderen im Diff.
    //
    // Umrechnung ICT (UTC+7, keine Sommerzeit) -> UTC:
    //   Mo 06:00 ICT = So 23:00 UTC   (cron-Wochentag 0)
    //   Mi 06:00 ICT = Di 23:00 UTC   (2)
    //   Fr 06:00 ICT = Do 23:00 UTC   (4)
    // Der Wochentag rutscht einen zurueck, weil 06:00 minus 7 Stunden ueber
    // Mitternacht faellt. Nur die Stunde umzurechnen und `1,3,5` stehen zu
    // lassen, waere um genau einen Tag daneben.
    tool({ name: 'google-maps-hoi-an', slug: 'google-maps', city: 'hoi-an', cron: '0 23 * * 0,2,4' }),

    // Ab hier: in `tool_configs` auf is_active=false, seit Monaten kein Lauf.
    // Die Cron-Zeiten sind aus `tool_configs.schedule` uebernommen, also aus
    // derselben Spalte, die bei google-maps-hoi-an nachweislich von Railway
    // abweicht. Vor `apply` gegen die Plan-Ausgabe pruefen.
    tool({ name: 'google-maps-da-nang', slug: 'google-maps', city: 'da-nang', mode: 'baseline_only', cron: '0 7 * * 2,6' }),
    tool({ name: 'sitemap-miner', slug: 'sitemap-miner', mode: 'baseline_only', cron: '0 3 * * *' }),
    tool({ name: 'google-alerts', slug: 'google-alerts', cron: '0 */6 * * *' }),
    tool({ name: 'osm-monitor', slug: 'osm-monitor', cron: '0 4 * * 0' }),
  ];

  return project('alles-neue-tools', { resources: tools });
});
