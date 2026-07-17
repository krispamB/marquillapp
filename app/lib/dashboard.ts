import type {
  DashboardPost,
  DashboardPostsResponse,
  PostDetailData,
} from "./types";

const POSTS_PAGE_SIZE = 20;

export function enrichDashboardPost(
  post: DashboardPost,
  detail?: PostDetailData,
): DashboardPost {
  const artifact = detail?.artifacts?.[0];
  return {
    ...post,
    content: artifact?.version?.content?.commentary ?? detail?.content ?? post.content,
    type: artifact?.artifact?.type ?? detail?.type ?? post.type,
    connectedAccountName: detail?.connectedAccount?.displayName,
  };
}

export function sortScheduledPosts(posts: DashboardPost[]) {
  return posts
    .filter((post) => post.status === "SCHEDULED")
    .sort(
      (left, right) =>
        new Date(left.scheduledAt ?? 0).getTime() -
        new Date(right.scheduledAt ?? 0).getTime(),
    );
}

export async function readAllPostPages(
  readPage: (page: number) => Promise<DashboardPostsResponse>,
) {
  const posts: DashboardPost[] = [];
  const seenIds = new Set<string>();

  for (let page = 1; ; page += 1) {
    const response = await readPage(page);
    const pagePosts = Array.isArray(response?.data) ? response.data : [];
    let newPostCount = 0;

    for (const post of pagePosts) {
      if (seenIds.has(post._id)) continue;
      seenIds.add(post._id);
      posts.push(post);
      newPostCount += 1;
    }

    if (pagePosts.length < POSTS_PAGE_SIZE || newPostCount === 0) break;
  }

  return posts;
}
