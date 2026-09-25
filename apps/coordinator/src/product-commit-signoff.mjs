import { serviceAssert } from "./service-contract.mjs";
import { realProfile } from "./profiles.mjs";

// The acting account explicitly authorized its DCO attestation for commits
// created by the Coordinator in the real product repositories. This does not
// sign source commits submitted by other developers.
const authorizedSigner = realProfile.product_commit_signer;
const email = `${authorizedSigner.id}+${authorizedSigner.login}@users.noreply.github.com`;

export function assertProductCommitActor(saved, observed) {
  serviceAssert(
    String(saved?.id) === authorizedSigner.id &&
      saved?.login === authorizedSigner.login &&
      String(observed?.id) === authorizedSigner.id &&
      observed?.login === authorizedSigner.login,
    "release-signoff",
    "Real product commits require the authorized, currently authenticated @simo6529 account."
  );
}

export function productCommitSignoff(actor, date, message) {
  assertProductCommitActor(actor, actor);
  serviceAssert(
    typeof message === "string" && message.length > 0,
    "release-signoff",
    "The product commit message is missing."
  );
  const identity = {
    name: authorizedSigner.name,
    email,
    date
  };
  return {
    message: `${message}\n\nSigned-off-by: ${identity.name} <${identity.email}>`,
    author: identity,
    committer: identity
  };
}
