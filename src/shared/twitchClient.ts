/** Public client id of Twitch's web player (as Streamlink and others use it). */
export const twitchWebClientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/**
 * Lurk's own public client at Twitch, only for "Von Twitch übernehmen" (device code, scope
 * user:read:follows; registered 2026-11-24, client type Public, redirect http://localhost – unused,
 * the device code flow never redirects). Twitch calls client ids public; there is no secret. Forks
 * register their own (CONTRIBUTING.md): Twitch may suspend a client id that several apps share.
 */
export const lurkTwitchClientId = '6ecx7tl5wtispb7d1lsnhf1fiszrbl';
