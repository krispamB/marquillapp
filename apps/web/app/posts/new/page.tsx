import CreatePostComposerClient from "../../redesign/CreatePostComposerClient";
import {
  loadInitialPostComposerData,
  resolveDraftQuery,
  type InitialPostComposerData,
} from "../../redesign/postComposer";
import { getWorkspaceProps } from "../../redesign/workspace";
import {
  getArtifactDetail,
  getPostDetail,
  getServerAuth,
} from "../../lib/session";

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string | string[] }>;
}) {
  const [workspace, query] = await Promise.all([
    getWorkspaceProps(),
    searchParams,
  ]);
  const draftQuery = resolveDraftQuery(query.draft);

  if (draftQuery.kind === "new") {
    return (
      <CreatePostComposerClient
        user={workspace.user}
        connectedAccounts={workspace.connectedAccounts}
        subscription={workspace.subscription}
      />
    );
  }

  if (draftQuery.kind === "invalid") {
    return (
      <CreatePostComposerClient
        user={workspace.user}
        connectedAccounts={workspace.connectedAccounts}
        subscription={workspace.subscription}
        initialLoadError="Unable to load this post."
      />
    );
  }

  let initialPost: InitialPostComposerData | undefined;
  let initialLoadError: string | undefined;
  try {
    const serverAuth = await getServerAuth();
    initialPost = await loadInitialPostComposerData(
      draftQuery.draftId,
      (postId) => getPostDetail(serverAuth, postId),
      (artifactId, version) => getArtifactDetail(
        serverAuth,
        artifactId,
        version,
      ),
    );
  } catch {
    initialLoadError = "Unable to load this post.";
  }

  return (
    <CreatePostComposerClient
      user={workspace.user}
      connectedAccounts={workspace.connectedAccounts}
      subscription={workspace.subscription}
      initialPost={initialPost}
      initialLoadError={initialLoadError}
    />
  );
}
