// Poster stills are pinned to moments; keep the cloud set each Earth still was rendered with.
// Mirrors scripts/posters/render.mjs: the portrait still may override the landscape parameters.
export function posterMoments(shots) {
  const moments = shots.flatMap(({ query, portraitQuery }) => {
    const landscape = new URLSearchParams(query);
    if (landscape.get('body') !== 'earth') return [];
    const portrait = new URLSearchParams(query);
    for (const [k, v] of new URLSearchParams(portraitQuery ?? '')) portrait.set(k, v);
    return [landscape, portrait].flatMap((params) => {
      const at = params.get('at');
      if (!at) return [];
      return [new Date(new Date(at).getTime() + Number(params.get('skip') ?? 0) * 1000).toISOString()];
    });
  });
  return [...new Set(moments)];
}
