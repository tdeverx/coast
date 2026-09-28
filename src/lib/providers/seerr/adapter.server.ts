import * as v from 'valibot';
import { ProviderActionError } from '../contracts';
import type {
  DiscoverKind,
  Metadata,
  ProviderTransport,
  RequestDestination,
  RequestScope,
} from '../contracts';
export const SeerrPermission = {
  ADMIN: 2,
  MANAGE_USERS: 8,
  MANAGE_REQUESTS: 16,
  REQUEST: 32,
  REQUEST_4K: 1024,
  REQUEST_4K_MOVIE: 2048,
  REQUEST_4K_TV: 4096,
  REQUEST_ADVANCED: 8192,
  REQUEST_VIEW: 16384,
  REQUEST_MOVIE: 262144,
  REQUEST_TV: 524288,
} as const;
export function seerrAllows(permissions: number, permission: number) {
  return !!(permissions & SeerrPermission.ADMIN) || !!(permissions & permission);
}
export function canRequest(permissions: number, kind: DiscoverKind, is4k = false) {
  return (
    (seerrAllows(permissions, SeerrPermission.REQUEST) ||
      seerrAllows(
        permissions,
        kind === 'movie' ? SeerrPermission.REQUEST_MOVIE : SeerrPermission.REQUEST_TV
      )) &&
    (!is4k ||
      seerrAllows(permissions, SeerrPermission.REQUEST_4K) ||
      seerrAllows(
        permissions,
        kind === 'movie' ? SeerrPermission.REQUEST_4K_MOVIE : SeerrPermission.REQUEST_4K_TV
      ))
  );
}
const userSchema = v.object({
  id: v.number(),
  username: v.nullish(v.string()),
  displayName: v.optional(v.string()),
  permissions: v.number(),
});
export const requestSchema = v.object({
  id: v.number(),
  status: v.number(),
  is4k: v.optional(v.boolean(), false),
  serverId: v.nullish(v.number()),
  type: v.optional(v.string()),
  createdAt: v.optional(v.string()),
  requestedBy: v.optional(v.object({ id: v.number(), displayName: v.optional(v.string()) })),
  seasons: v.optional(v.array(v.object({ seasonNumber: v.number(), status: v.number() })), []),
  media: v.optional(
    v.object({
      id: v.number(),
      tmdbId: v.number(),
      mediaType: v.optional(v.string()),
      status: v.number(),
      status4k: v.optional(v.number()),
    })
  ),
});
export type SeerrRequest = v.InferOutput<typeof requestSchema>;
const searchSchema = v.object({
  results: v.array(
    v.object({
      id: v.number(),
      mediaType: v.string(),
      title: v.optional(v.string()),
      name: v.optional(v.string()),
      originalTitle: v.optional(v.string()),
      originalName: v.optional(v.string()),
      overview: v.optional(v.string()),
      posterPath: v.nullish(v.string()),
      backdropPath: v.nullish(v.string()),
      releaseDate: v.optional(v.string()),
      firstAirDate: v.optional(v.string()),
    })
  ),
});
const serverSchema = v.object({
  id: v.number(),
  name: v.string(),
  is4k: v.optional(v.boolean(), false),
  isDefault: v.optional(v.boolean(), false),
});
/** One media-server destination contains its standard and 4K backend choices. */
export function groupDestination(
  instanceId: string,
  name: string,
  servers: v.InferOutput<typeof serverSchema>[],
  permissions: number,
  kind: DiscoverKind
): RequestDestination[] {
  const standard = servers.find((s) => !s.is4k && s.isDefault) || servers.find((s) => !s.is4k),
    fourK = servers.find((s) => s.is4k && s.isDefault) || servers.find((s) => s.is4k);
  if (!canRequest(permissions, kind) || (!standard && !fourK)) return [];
  return [
    {
      id: instanceId,
      name,
      standardServerId: standard?.id,
      fourKServerId: fourK?.id,
      can4k: !!fourK && canRequest(permissions, kind, true),
    },
  ];
}
export function remainingSeasons(
  requested: number[],
  existing: SeerrRequest[],
  is4k: boolean,
  serverId?: number
) {
  const claimed = new Set(
    existing
      .filter(
        (r) =>
          r.status !== 3 &&
          r.is4k === is4k &&
          (serverId === undefined ||
            r.serverId === undefined ||
            r.serverId === null ||
            r.serverId === serverId)
      )
      .flatMap((r) => r.seasons.filter((s) => s.status !== 3).map((s) => s.seasonNumber))
  );
  return [...new Set(requested)].filter((n) => !claimed.has(n));
}
export class SeerrAdapter {
  constructor(
    private request: ProviderTransport,
    private apiKey: string,
    private userId?: number
  ) {}
  private call(path: string, init: RequestInit = {}) {
    return this.request(`/api/v1${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
        ...(this.userId !== undefined ? { 'X-Api-User': String(this.userId) } : {}),
        ...init.headers,
      },
    });
  }
  private catalogue(data: unknown): Metadata[] {
    return v
      .parse(searchSchema, data)
      .results.filter((x) => x.mediaType === 'movie' || x.mediaType === 'tv')
      .map((x) => ({
        provider: 'seerr',
        externalId: String(x.id),
        externalIds: { tmdb: String(x.id) },
        kind: x.mediaType === 'tv' ? 'show' : 'movie',
        title: x.title || x.name || 'Untitled',
        originalTitle: x.originalTitle || x.originalName,
        overview: x.overview,
        releaseDate: x.releaseDate || x.firstAirDate || undefined,
        posterPath:
          x.posterPath && /^\/[\w.-]+$/.test(x.posterPath)
            ? `https://image.tmdb.org/t/p/w780${x.posterPath}`
            : undefined,
        backdropPath:
          x.backdropPath && /^\/[\w.-]+$/.test(x.backdropPath)
            ? `https://image.tmdb.org/t/p/original${x.backdropPath}`
            : undefined,
      }));
  }
  async search(query: string, page = 1) {
    return this.catalogue(
      await this.call(
        `/search?${new URLSearchParams({ query, page: String(page), language: 'en' })}`
      )
    );
  }
  async trending(page = 1) {
    return this.catalogue(await this.call(`/discover/trending?page=${page}&language=en`));
  }
  async user() {
    return v.parse(userSchema, await this.call('/auth/me'));
  }
  async jellyfinUser(jellyfinId: string) {
    return v.parse(userSchema, await this.call(`/user/jellyfin/${encodeURIComponent(jellyfinId)}`));
  }
  async servers(kind: DiscoverKind) {
    return v.parse(
      v.array(serverSchema),
      await this.call(`/service/${kind === 'movie' ? 'radarr' : 'sonarr'}`)
    );
  }
  async requests(offset = 0, all = false) {
    const me = await this.user();
    if (all && !seerrAllows(me.permissions, SeerrPermission.MANAGE_REQUESTS))
      throw new ProviderActionError(
        'You do not have permission to manage other users’ requests.',
        'permission'
      );
    return v.parse(
      v.object({
        results: v.array(requestSchema),
        pageInfo: v.optional(
          v.object({ results: v.optional(v.number()), pages: v.optional(v.number()) })
        ),
      }),
      await this.call(
        `/request?take=100&skip=${offset}&sort=added${all ? '' : `&requestedBy=${me.id}`}`
      )
    );
  }
  async details(kind: DiscoverKind, tmdbId: number) {
    return v.parse(
      v.object({
        id: v.number(),
        seasons: v.optional(
          v.array(v.object({ seasonNumber: v.number(), episodeCount: v.number() })),
          []
        ),
        mediaInfo: v.optional(
          v.object({
            status: v.number(),
            status4k: v.optional(v.number()),
            requests: v.optional(v.array(requestSchema), []),
            seasons: v.optional(
              v.array(
                v.object({
                  seasonNumber: v.number(),
                  status: v.number(),
                  status4k: v.optional(v.number()),
                })
              ),
              []
            ),
          })
        ),
      }),
      await this.call(`/${kind === 'show' ? 'tv' : 'movie'}/${tmdbId}`)
    );
  }
  async create(scope: RequestScope) {
    const me = await this.user();
    if (!canRequest(me.permissions, scope.kind, scope.is4k))
      throw new ProviderActionError(
        'You do not have permission to request this version.',
        'permission'
      );
    const details = await this.details(scope.kind, scope.tmdbId);
    const requests = details.mediaInfo?.requests || [];
    const existing = requests.find(
      (r) =>
        r.status !== 3 &&
        r.is4k === scope.is4k &&
        (scope.serverId === undefined || r.serverId == null || r.serverId === scope.serverId)
    );
    if (scope.kind === 'movie' && existing) return existing;
    const scopeSeasons = scope.seasons || [];
    if (
      scope.kind === 'show' &&
      (!scopeSeasons.length ||
        scopeSeasons.some(
          (n) =>
            !Number.isSafeInteger(n) ||
            n < 0 ||
            !details.seasons.some((s) => s.seasonNumber === n && s.episodeCount > 0)
        ))
    )
      throw new ProviderActionError(
        'Choose at least one valid season to request.',
        'invalid-request'
      );
    const seasons = remainingSeasons(scopeSeasons, requests, scope.is4k, scope.serverId).filter(
      (n) =>
        !details.mediaInfo?.seasons.some(
          (s) => s.seasonNumber === n && (scope.is4k ? s.status4k : s.status) === 5
        )
    );
    if (scope.kind === 'show' && !seasons.length) {
      if (existing) return existing;
      throw new ProviderActionError(
        'All selected seasons are already available or requested.',
        'invalid-request'
      );
    }
    if (
      scope.kind === 'movie' &&
      (scope.is4k ? details.mediaInfo?.status4k : details.mediaInfo?.status) === 5
    )
      throw new ProviderActionError('This version is already available.', 'invalid-request');
    return v.parse(
      requestSchema,
      await this.call('/request', {
        method: 'POST',
        body: JSON.stringify({
          mediaType: scope.kind === 'show' ? 'tv' : 'movie',
          mediaId: scope.tmdbId,
          is4k: scope.is4k,
          serverId: scope.serverId,
          ...(scope.kind === 'show' ? { seasons } : {}),
        }),
      })
    );
  }
  async requestDetails(requestId: number) {
    return v.parse(requestSchema, await this.call(`/request/${requestId}`));
  }
  async manage(requestId: number, action: 'cancel' | 'approve' | 'decline') {
    const me = await this.user();
    let request: SeerrRequest;
    try {
      request = v.parse(requestSchema, await this.call(`/request/${requestId}`));
    } catch (error) {
      if (action === 'cancel' && (error as { status?: number }).status === 404) return;
      throw error;
    }
    const manager = seerrAllows(me.permissions, SeerrPermission.MANAGE_REQUESTS);
    if (
      action === 'cancel'
        ? !manager && (request.requestedBy?.id !== me.id || request.status !== 1)
        : !manager
    )
      throw new ProviderActionError(
        'You do not have permission to change this request.',
        'permission'
      );
    if (
      (action === 'approve' && request.status === 2) ||
      (action === 'decline' && request.status === 3)
    )
      return;
    await this.call(`/request/${requestId}${action === 'cancel' ? '' : `/${action}`}`, {
      method: action === 'cancel' ? 'DELETE' : 'POST',
    });
  }
}
