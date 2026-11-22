// Poster stills are pinned to moments; keep the cloud set each Earth poster was rendered with.
export function posterMoments(shots) {
  return shots.flatMap(({ query }) => {
    const params = new URLSearchParams(query);
    const at = params.get('at');
    if (params.get('body') !== 'earth' || !at) return [];
    const skip = Number(params.get('skip') ?? 0);
    return [new Date(new Date(at).getTime() + skip * 1000).toISOString()];
  });
}
