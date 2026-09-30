/// Viewport-relative scroll cache for dense commercial lists (ListView/GridView).
///
/// One screen of offscreen extent keeps scroll jank low without prebuilding
/// the whole catalog (objetivos clients, almacén articles/orders).
double denseScrollCacheExtent(double viewportHeight) {
  if (viewportHeight <= 0) return 0;
  return viewportHeight;
}
