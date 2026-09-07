import { getCollection, type CollectionEntry } from "astro:content";
import type { Locale } from "@/i18n/config";
import type { HomeTranslations } from "@/i18n/translations";
import type {
  LocalizedComponent,
  LocalizedStack,
  LocalizedField,
  SectionId,
  StackComponent,
} from "@/types/stack";

const SECTION_ORDER: SectionId[] = [
  "data-services",
  "control-plane",
  "dependencies",
];

function getLocalizedField(
  field: LocalizedField | null | undefined,
  locale: Locale,
): string | null {
  if (!field) return null;
  if (typeof field === "string") return field;
  return field[locale] || field.en || null;
}

function localizeComponent(
  component: StackComponent,
  locale: Locale,
): LocalizedComponent {
  return {
    ...component,
    description: getLocalizedField(component.description, locale),
  };
}

/** "okdp-1-0" -> "1.0", matching the stack version the generator recorded. */
export function slugToVersion(slug: string): string {
  return slug.replace(/^okdp-/, "").replace(/-/g, ".");
}

export async function getStackEntries(): Promise<CollectionEntry<"stacks">[]> {
  const entries = await getCollection("stacks");
  return entries.sort((a, b) =>
    b.data.stack.localeCompare(a.data.stack, undefined, { numeric: true }),
  );
}

export async function getLocalizedStack(
  slug: string,
  locale: Locale,
  content: HomeTranslations,
): Promise<LocalizedStack | null> {
  const entries = await getStackEntries();
  const entry = entries.find((candidate) => candidate.id === slug);
  if (!entry) return null;

  const components = entry.data.components.map((component) =>
    localizeComponent(component as StackComponent, locale),
  );

  const sections = SECTION_ORDER.map((id) => ({
    id,
    title: content.stackPage.sections[id].title,
    description: content.stackPage.sections[id].description,
    components: components.filter((component) => component.section === id),
  })).filter((section) => section.components.length > 0);

  return {
    version: entry.data.stack,
    slug: entry.id,
    sections,
    components,
    counts: {
      total: components.length,
      // The "we don't fork the ecosystem" figure, computed rather than claimed.
      upstreamOnly: components.filter(
        (component) =>
          component.provenance.length === 1 &&
          component.provenance[0] === "upstream-chart",
      ).length,
    },
    sources: entry.data.generated.sources,
  };
}
