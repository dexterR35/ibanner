const normalize = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .trim();
export function lexicalSearch(assets, query, corrections = {}, analyses = []) {
  const q = normalize(query),
    tokens = q.split(/\s+/).filter(Boolean);
  return assets
    .map((asset) => {
      const c = corrections[asset.id]?.value || {},
        ocr = analyses
          .filter((a) => a.assetId === asset.id && a.component === 'ocr' && a.status === 'ready')
          .flatMap((a) => a.ocr || [])
          .map((o) => o.text)
          .join(' ');
      const text = normalize([asset.name, ...(c.tags || []), c.ocrText || ocr].join(' '));
      return {
        assetId: asset.id,
        score: !q
          ? 1
          : (normalize(asset.name) === q ? 100 : 0) + tokens.filter((t) => text.includes(t)).length,
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId));
}
export function fuseRanks(channels) {
  const scores = new Map();
  channels.forEach((channel, channelIndex) =>
    channel.forEach((hit, index) => {
      const old = scores.get(hit.assetId) || { assetId: hit.assetId, score: 0, channels: [] };
      old.score += 1 / (60 + index + 1);
      old.channels.push(channelIndex);
      scores.set(hit.assetId, old);
    }),
  );
  return [...scores.values()].sort(
    (a, b) => b.score - a.score || a.assetId.localeCompare(b.assetId),
  );
}
export function retrievalMetrics(ranked, relevant, k = 10) {
  const labels = new Set(relevant),
    hits = ranked.slice(0, k).map((id) => (labels.has(id) ? 1 : 0));
  const dcg = hits.reduce((s, r, i) => s + r / Math.log2(i + 2), 0),
    ideal = Array.from({ length: Math.min(k, labels.size) }, (_, i) => 1 / Math.log2(i + 2)).reduce(
      (a, b) => a + b,
      0,
    );
  return {
    recall: labels.size ? hits.reduce((a, b) => a + b, 0) / labels.size : 0,
    ndcg: ideal ? dcg / ideal : 0,
  };
}
