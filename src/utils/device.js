// Rough phone detection via User-Agent. Deliberately excludes tablets
// (iPad, Android tablets) — those render this app at desktop-ish widths and
// can have external/on-screen keyboards attached, so keyboard shortcuts
// still make sense there. The goal here is just to suppress shortcut
// hints/handlers on true handheld phones, where there's normally no
// keyboard to press them with.
export const isPhone = /iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|IEMobile/i.test(
	typeof navigator !== "undefined" ? navigator.userAgent : "",
);
