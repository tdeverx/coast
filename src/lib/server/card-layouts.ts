import * as v from 'valibot';
import { cardBadgeFields, cardMetadataFields, cardMetadataSizes, cardTextFields } from '#lib/ui/card-slots.js';
import {
  cardArtworkPriorities, cardImageTypes, cardLayoutDefaults, cardLayoutKey, cardLayoutTargets, cardOverlays, cardShapes,
  maxCardFields, maxCardLayers, type CardLayoutValues, type CardLayouts,
} from '#lib/ui/cards/layout.js';
import { requireUser, type SessionUser } from './auth';
import { getSql } from './db';
import { getFeatureConfig, featureDenialMessage } from './features';
import { AppError } from './security/errors';

const flag = v.boolean();
const headerField = v.picklist(['none', ...cardTextFields.map(({ id }) => id)]);
const badgeField = v.picklist(cardBadgeFields.map(({ id }) => id));
const metadataValue = v.pipe(v.string(), v.maxLength(200));
const valueFields = [...cardTextFields.map(({ id }) => id), 'default', 'rating', 'match', 'body', 'footer'] as const;

export const cardLayoutSave = v.object({
  target: v.picklist(cardLayoutTargets),
  layout: v.nullable(v.object({
    settings: v.partial(v.object({
      shape: v.picklist(cardShapes), artwork: flag, monochromeMissing: flag, artworkStyle: v.picklist(cardImageTypes),
      artworkPriority: v.picklist(cardArtworkPriorities), overlay: v.picklist(cardOverlays), headerLeading: headerField,
      headerTrailing: headerField, caption: flag, badges: flag, header: flag, progressBar: flag, primaryAction: flag,
      artworkMenu: flag, secondaryAction: flag, requestStatus: flag, body: flag, footer: flag,
    })),
    badgeSlots: v.object({ 'top-left': badgeField, 'top-right': badgeField, 'bottom-left': badgeField, 'bottom-right': badgeField }),
    metadataLayers: v.pipe(v.array(v.object({
      id: v.pipe(v.number(), v.safeInteger(), v.minValue(0)), size: v.picklist(cardMetadataSizes.map(({ id }) => id)),
      fields: v.pipe(v.array(v.picklist(cardMetadataFields.map(({ id }) => id))), v.minLength(1), v.maxLength(maxCardFields)),
    })), v.maxLength(maxCardLayers), v.check(layers => new Set(layers.map(layer => layer.id)).size === layers.length)),
    metadataValues: v.partial(v.object(Object.fromEntries(valueFields.map(field => [field, metadataValue])) as Record<keyof CardLayoutValues, typeof metadataValue>)),
  })),
});

export async function saveCardLayout(actor: SessionUser | null, input: unknown) {
  const user = requireUser(actor);
  const { target, layout } = v.parse(cardLayoutSave, input);
  const key = cardLayoutKey(target);
  return getSql().begin(async sql => {
    await sql`select pg_advisory_xact_lock_shared(hashtextextended('coast:configuration',0))`;
    const [current] = await sql<{ settings: SessionUser['settings'] }[]>`select settings from users where id=${user.id} for update`;
    const config = await getFeatureConfig(user.id, sql);
    if (!current || !config.features.cardLayouts) {
      throw new AppError(403, featureDenialMessage(config.featureDenials.cardLayouts), 'feature_disabled');
    }
    const layouts: CardLayouts = { ...current.settings.cardLayouts };
    if (layout) layouts[key] = { ...layout, settings: { ...cardLayoutDefaults, ...layout.settings } };
    else delete layouts[key];
    await sql`update users set settings=jsonb_set(settings, '{cardLayouts}', ${layouts}::jsonb)
      where id=${user.id} and coalesce(settings->'cardLayouts', '{}'::jsonb) is distinct from ${layouts}::jsonb`;
    return layouts;
  });
}
