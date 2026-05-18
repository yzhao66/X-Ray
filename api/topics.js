const fs = require("fs");
const path = require("path");

function readPosts() {
  const postsPath = path.join(process.cwd(), "backend", "src", "main", "resources", "mock", "x_posts.json");
  return JSON.parse(fs.readFileSync(postsPath, "utf8"));
}

function boardOf(post) {
  if (post.post_id.startsWith("ai_")) return "AI";
  if (post.post_id.startsWith("crypto_")) return "Crypto";
  if (post.post_id.startsWith("stock_")) return "Stock";
  if (post.post_id.startsWith("macro_")) return "Macro";
  if (post.post_id.startsWith("startup_")) return "Startup";
  return "Risk";
}

function roleOf(post) {
  const text = String(post.text || "").toLowerCase();
  if (/giveaway|airdrop|100x|moon|claim now|referral|free mint|join telegram/.test(text)) return "spam";
  if (/not enough|not true|risk|unverified|overstated|however|but|questionable/.test(text)) return "counter";
  if ((post.external_links || []).length || (post.media_urls || []).length || /data|github|etherscan|filing|release|status page/.test(text)) return "evidence";
  if (post.reference_type && post.author_followers_count > 100000) return "amplifier";
  if (/my take|analysis|this means|because|implication|watch for/.test(text)) return "opinion";
  return "source";
}

function scorePost(post) {
  const engagement = post.like_count + post.repost_count * 2 + post.quote_count * 3 + post.reply_count;
  const author = Math.min(42, Math.log10(Math.max(10, post.author_followers_count)) * 8);
  const evidence = ((post.external_links || []).length ? 22 : 0) + ((post.media_urls || []).length ? 12 : 0);
  const verified = post.author_verified ? 8 : 0;
  const spamPenalty = roleOf(post) === "spam" ? 55 : 0;
  return Math.max(0, Math.min(100, Math.round(author + evidence + verified + Math.log10(engagement + 1) * 8 - spamPenalty)));
}

function statusFor(posts) {
  const roles = posts.map(roleOf);
  const joined = posts.map((post) => post.text).join(" ").toLowerCase();
  if (/hack|exploit|breach|outflow|bankruptcy|halted|lawsuit/.test(joined)) return "high_risk";
  if (roles.includes("counter")) return "unverified";
  if (roles.includes("evidence")) return "confirmed";
  return "developing";
}

function titleFor(post) {
  const text = String(post.text || "");
  const clean = text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return clean.length > 112 ? `${clean.slice(0, 109)}...` : clean;
}

function buildTopics() {
  const groups = new Map();
  for (const post of readPosts()) {
    const key = post.conversation_id || `${post.author_username}:${post.post_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(post);
  }

  return Array.from(groups.entries()).map(([key, posts]) => {
    const enriched = posts
      .map((post) => ({ ...post, board: boardOf(post), role: roleOf(post), score: scorePost(post) }))
      .sort((a, b) => b.score - a.score);
    const top = enriched[0];
    const roleCounts = enriched.reduce((acc, post) => {
      acc[post.role] = (acc[post.role] || 0) + 1;
      return acc;
    }, {});
    const evidenceCount = (roleCounts.evidence || 0) + (roleCounts.source || 0);
    const hot = Math.min(100, Math.round(Math.max(...enriched.map((post) => post.score)) + Math.log(enriched.length + 1) * 10));
    return {
      id: key,
      board: top.board,
      title: titleFor(top),
      status: statusFor(enriched),
      hot,
      confidence: Math.min(100, 48 + evidenceCount * 15 - (roleCounts.spam || 0) * 8),
      firstSeen: enriched.map((post) => post.posted_at).sort()[0],
      lastSeen: enriched.map((post) => post.posted_at).sort().at(-1),
      roleCounts,
      posts: enriched
    };
  }).sort((a, b) => b.hot - a.hot);
}

module.exports = function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  res.status(200).json(buildTopics());
};
