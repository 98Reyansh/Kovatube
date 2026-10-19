// Which media surface owns the global keyboard shortcuts.
//
// The music player (MiniPlayer) is mounted for the whole session, so its
// always-on shortcut listener would collide with page-specific players that
// bind the same keys — the video player (VideoDetail) and the Shorts feed.
// Each of those pushes itself on top while its listener is registered and
// pops off when it unmounts; the top of the stack wins, so keys always act
// on the surface the user is actually looking at.
const stack = []

export function pushMediaFocus(id) {
  stack.push(id)
  return () => {
    const i = stack.lastIndexOf(id)
    if (i >= 0) stack.splice(i, 1)
  }
}

export function currentMediaFocus() {
  return stack[stack.length - 1] || 'none'
}
