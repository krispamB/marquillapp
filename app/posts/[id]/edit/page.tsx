import CreatePostComposerClient from "../../../redesign/CreatePostComposerClient";
import { createInitialPostComposerData } from "../../../redesign/postComposer";
import { getWorkspaceProps } from "../../../redesign/workspace";
import { getPostDetail, getServerAuth } from "../../../lib/session";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [workspace, serverAuth] = await Promise.all([getWorkspaceProps(), getServerAuth()]);
  try {
    const response = await getPostDetail(serverAuth, id);
    if (!response.data) throw new Error("The saved post was unavailable.");
    const initialPost = createInitialPostComposerData(response.data);
    return <CreatePostComposerClient user={workspace.user} connectedAccounts={workspace.connectedAccounts} subscription={workspace.subscription} initialPost={initialPost} />;
  } catch {
    return <CreatePostComposerClient user={workspace.user} connectedAccounts={workspace.connectedAccounts} subscription={workspace.subscription} initialLoadError="Unable to load this post." />;
  }
}
