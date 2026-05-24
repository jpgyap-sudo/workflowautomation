/**
 * Furniture Category Taxonomy
 *
 * Extracted from www.homeu.ph navigation and collections.
 * Used by AI vision extraction to auto-classify inventory items.
 *
 * Source: https://homeu.ph/collections
 */

export const FURNITURE_CATEGORIES = [
  // ── Seating ─────────────────────────────────────────────────────────
  'Sofa',
  'Armchair',
  'Lounge Chair',
  'Accent Chair',
  'Chaise Lounge',
  'Bench',
  'Ottoman & Pouf',
  'Bar Stool',
  'Dining Chair',
  'Modular Seating',
  'Collection Set',

  // ── Tables ──────────────────────────────────────────────────────────
  'Coffee Table',
  'Center Table',
  'Side Table',
  'Console Table',
  'Dining Table',

  // ── Storage ─────────────────────────────────────────────────────────
  'Sideboard',
  'TV Cabinet',
  'TV Stand',
  'Night Stand',

  // ── Bedroom ─────────────────────────────────────────────────────────
  'Bed',
  'Bed Bench',

  // ── Lighting ────────────────────────────────────────────────────────
  'Ceiling Fan',
  'Table Lamp',
  'Pendant Light',
  'Ceiling Light',
  'Floor Lamp',
  'Wall Light',

  // ── Decor & Accessories ─────────────────────────────────────────────
  'Rug',
  'Throw Pillow',
  'Decorative',

  // ── Wall & Stone ────────────────────────────────────────────────────
  'Wall Panel',
  'Sintered Stone',
  'Natural Stone',

  // ── Other ───────────────────────────────────────────────────────────
  'Finish Material',
  'Unknown',
] as const;

export type FurnitureCategory = (typeof FURNITURE_CATEGORIES)[number];

/**
 * Compact comma-separated list for injection into AI prompts.
 */
export const FURNITURE_CATEGORY_LIST = FURNITURE_CATEGORIES.join(', ');

/**
 * Prompt fragment that instructs the AI how to classify.
 */
export const CATEGORY_CLASSIFICATION_RULES = `
For each item, also determine its furniture category based on the product name, description, and any visible details.
Choose the SINGLE best match from this exact list:
${FURNITURE_CATEGORY_LIST}

Classification rules:
- "Sofa" includes sofas, couches, sofa beds, L-shaped sofas, sectional sofas.
- "Armchair" includes single-seat armchairs, recliners, club chairs.
- "Lounge Chair" includes accent lounge chairs, designer lounge chairs.
- "Accent Chair" includes single decorative chairs without arms.
- "Chaise Lounge" includes chaise longues, daybeds.
- "Bench" includes entryway benches, dining benches, bed benches.
- "Ottoman & Pouf" includes footstools, poufs, ottomans.
- "Bar Stool" includes counter stools, bar height stools.
- "Dining Chair" includes all dining room chairs.
- "Modular Seating" includes modular sofa pieces, sectional components.
- "Collection Set" includes matched furniture sets (sofa + armchair + table combos).
- "Coffee Table" includes living room coffee tables, cocktail tables.
- "Center Table" includes center tables (often synonymous with coffee table in local context).
- "Side Table" includes end tables, bedside side tables, accent side tables.
- "Console Table" includes hallway console tables, entryway tables, sofa back tables.
- "Dining Table" includes all dining tables, round tables, extendable tables.
- "Sideboard" includes credenzas, buffets, side cabinets.
- "TV Cabinet" includes TV consoles, entertainment units.
- "TV Stand" includes simple TV stands, media stands.
- "Night Stand" includes bedside tables, night tables.
- "Bed" includes all bed frames, platform beds, upholstered beds.
- "Bed Bench" includes bench seats at foot of bed.
- "Ceiling Fan" includes all ceiling fans with or without lights.
- "Table Lamp" includes desk lamps, bedside lamps, accent lamps.
- "Pendant Light" includes hanging pendant lights, chandeliers (if pendant style).
- "Ceiling Light" includes flush mount ceiling lights, downlights, spotlights.
- "Floor Lamp" includes standing floor lamps, arc lamps.
- "Wall Light" includes wall sconces, wall-mounted lights.
- "Rug" includes area rugs, carpets, floor mats.
- "Throw Pillow" includes decorative cushions, pillow covers.
- "Decorative" includes vases, sculptures, mirrors, clocks, and general decor.
- "Wall Panel" includes fluted wall panels, slat panels, wood panels, WPC panels.
- "Sintered Stone" includes sintered stone slabs, tabletops, stone finishes.
- "Natural Stone" includes marble, granite, travertine, onyx.
- "Finish Material" includes fabric swatches, leather samples, material samples.
- Use "Unknown" ONLY if the item type is completely unrecognizable.
`;
