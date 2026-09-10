import type { Locale } from "@/i18n/config";

export type LocalizedField = string | Partial<Record<Locale, string>>;

/** How OKDP obtains a component, shown as badges in the Provenance column. */
export type Provenance = "upstream-chart" | "okdp-chart" | "okdp-image";

export type SectionId = "data-services" | "control-plane" | "dependencies";

/** A curated caveat about a component, keyed into the locale files. */
export interface Notice {
  level: "info" | "warning";
  key: string;
}

export interface ChartRef {
  name: string;
  version: string | null;
  repository: string | null;
  origin: "upstream" | "okdp" | "local";
}

export interface ImageRef {
  repository: string;
  tag: string;
}

/** One module of a package: the component itself, or a helper alongside it. */
export interface ModuleRef {
  name: string;
  charts: ChartRef[];
  images: ImageRef[];
}

export interface StackComponent {
  id: string;
  name: string;
  section: SectionId;
  upstreamVersion: string;
  upstreamVersionSource: string;
  package: { repository: string; tag: string };
  provenance: Provenance[];
  protected: boolean;
  description: LocalizedField | null;
  primaryChart: ChartRef | null;
  primaryImage: ImageRef | null;
  charts: ChartRef[];
  images: ImageRef[];
  modules: ModuleRef[];
  links: { upstream: string | null; source: string };
  notice: Notice | null;
}

export interface StackSource {
  sha: string;
  date: string | null;
  url: string;
}

export interface Stack {
  stack: string;
  generated: { by: string; note: string; sources: Record<string, StackSource> };
  components: StackComponent[];
}

/** A component with its localized strings resolved, ready to render. */
export interface LocalizedComponent extends Omit<
  StackComponent,
  "description"
> {
  description: string | null;
}

export interface LocalizedSection {
  id: SectionId;
  title: string;
  description: string;
  components: LocalizedComponent[];
}

export interface LocalizedStack {
  version: string;
  slug: string;
  sections: LocalizedSection[];
  components: LocalizedComponent[];
  counts: { total: number; upstreamOnly: number };
  sources: Record<string, StackSource>;
}
