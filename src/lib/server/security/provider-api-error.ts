import type {ProviderHttpError} from './provider-fetch';

/** Upstream authentication is an integration failure, never Coast's own authentication response. */
export function providerApiError(error:ProviderHttpError) {
  const limited=error.status===429,rejected=error.status===401||error.status===403;
  const seconds=Number.isFinite(error.retryAfterSeconds)?Math.min(86400,Math.max(0,Math.ceil(error.retryAfterSeconds!))):60;
  return {
    status:limited?429:502,
    body:{code:limited?'provider_rate_limited':rejected?'provider_rejected':'provider_unavailable',
      error:limited?'The connected service is limiting requests. Try again later.':
        rejected?'The connected service rejected this request. Check its credentials and permissions.':
          'The connected service could not complete this request. Try again later.'},
    headers:limited?{'Retry-After':String(seconds)}:undefined,
  };
}
