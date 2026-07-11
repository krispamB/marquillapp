import PostsRedesignClient from "../redesign/PostsClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function PostsPage() {
  const workspace = await getWorkspaceProps();
  return <PostsRedesignClient {...workspace} />;
}
