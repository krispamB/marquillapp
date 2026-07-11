import ComposerRedesignClient from "../../redesign/ComposerClient";
import { getWorkspaceProps } from "../../redesign/workspace";

export default async function NewPostPage() {
  const workspace = await getWorkspaceProps();
  return <ComposerRedesignClient {...workspace} mode="create" />;
}
