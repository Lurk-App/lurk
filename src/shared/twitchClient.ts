/** Public client id of Twitch's web player (as Streamlink and others use it). */
export const twitchWebClientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/**
 * Lurk's own public client at Twitch, only for "Von Twitch übernehmen" (device code, scope
 * user:read:follows). Twitch calls client ids public; there is no secret. Empty until the project's
 * Twitch application is registered – the feature is hidden then. Forks register their own
 * (CONTRIBUTING.md): Twitch may suspend a client id that several apps share.
 */
export const lurkTwitchClientId = '';
