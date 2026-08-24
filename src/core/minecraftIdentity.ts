/** Minecraft usernames are unique without regard to display capitalization. */
export function sameMinecraftUsername(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toLowerCase()
  const normalizedRight = right.trim().toLowerCase()
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight
}
