/**
 * Detects what kind of media a URL points to. Used for both a promotion's
 * legacy single `url` field and each `promotion_media.media_url` row —
 * pasted URLs are classified the same way in both the admin form and the
 * customer-facing renderer, so the two never disagree about what a link is.
 *
 * Known video hosts (YouTube/Vimeo) get their official embeddable player
 * URL, with query params configured for silent, looping, chromeless
 * autoplay — that's the safe way to get a controls-free video from those
 * hosts, since they explicitly support it via documented embed parameters
 * (unlike blindly iframing an arbitrary page, which almost always gets
 * blocked by that site's own X-Frame-Options/CSP). A direct video file
 * (.mp4/.webm/etc) is flagged so callers can use a native <video> player.
 * Anything else is treated as "try it as an image" — most links in
 * practice ARE an image URL, including ones with no file extension (e.g.
 * CDN links) — callers should fall back to a clean tap-to-open card if it
 * turns out not to load as an image.
 */
export type PromoMediaKind = 'youtube' | 'vimeo' | 'video-file' | 'image-or-link';

export function detectPromoMedia(url: string): { kind: PromoMediaKind; embedUrl?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'image-or-link' };
  }

  const path = parsed.pathname.toLowerCase();
  if (/\.(mp4|webm|ogv|mov)$/i.test(path)) {
    return { kind: 'video-file' };
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = parsed.pathname.slice(1);
    } else if (parsed.pathname.startsWith('/embed/')) {
      videoId = parsed.pathname.split('/embed/')[1] ?? '';
    } else if (parsed.pathname.startsWith('/shorts/')) {
      videoId = parsed.pathname.split('/shorts/')[1] ?? '';
    } else {
      videoId = parsed.searchParams.get('v') ?? '';
    }
    videoId = videoId.split(/[/?&]/)[0];
    if (videoId) {
      // loop=1 only loops a single video when paired with playlist=<same id>.
      // controls=0/disablekb/fs=0 remove all YouTube chrome; mute+autoplay
      // is required by every mobile browser's autoplay policy.
      const params = new URLSearchParams({
        autoplay: '1',
        mute: '1',
        loop: '1',
        playlist: videoId,
        controls: '0',
        disablekb: '1',
        fs: '0',
        modestbranding: '1',
        rel: '0',
        iv_load_policy: '3',
        playsinline: '1',
      });
      return {
        kind: 'youtube',
        embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`,
      };
    }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = parsed.pathname.match(/(\d+)/);
    if (match) {
      // background=1 is Vimeo's own "ambient looping video" mode — built
      // for exactly this use case, and hides all Vimeo UI on its own. The
      // rest are set explicitly too for older player versions.
      const params = new URLSearchParams({
        autoplay: '1',
        muted: '1',
        loop: '1',
        background: '1',
        controls: '0',
        dnt: '1',
      });
      return {
        kind: 'vimeo',
        embedUrl: `https://player.vimeo.com/video/${match[1]}?${params.toString()}`,
      };
    }
  }

  return { kind: 'image-or-link' };
}

/** Best-effort image/video guess for a pasted URL, used by the admin form
 * to classify a link before it's ever displayed (uploaded files don't need
 * this — their type is read directly from the browser File object). */
export function guessMediaTypeFromUrl(url: string): 'image' | 'video' {
  return detectPromoMedia(url).kind === 'image-or-link' ? 'image' : 'video';
}
