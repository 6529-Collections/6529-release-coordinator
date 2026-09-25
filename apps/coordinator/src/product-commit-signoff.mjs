import { serviceAssert } from "./service-contract.mjs";
import { realProfile } from "./profiles.mjs";

// The acting account explicitly authorized its DCO attestation for commits
// created by the Coordinator in the real product repositories. This does not
// sign source commits submitted by other developers.
function authorizedSigner() {
  const signer = realProfile.product_commit_signer;
  serviceAssert(
    /^[1-9][0-9]*$/u.test(signer?.id ?? "") &&
      /^[A-Za-z0-9-]+$/u.test(signer?.login ?? "") &&
      typeof signer?.name === "string" &&
      signer.name.length > 0 &&
      !/[\r\n<>]/u.test(signer.name) &&
      /^[^\s<>@]+@[^\s<>@]+$/u.test(signer?.email ?? ""),
    "release-signoff",
    "The trusted real product signer is not configured."
  );
  return signer;
}

export function assertProductCommitActor(saved, observed) {
  const signer = authorizedSigner();
  serviceAssert(
    String(saved?.id) === signer.id &&
      saved?.login === signer.login &&
      String(observed?.id) === signer.id &&
      observed?.login === signer.login,
    "release-signoff",
    "Real product commits require the authorized, currently authenticated @simo6529 account."
  );
}

export function productCommitSignoff(actor, date, message) {
  assertProductCommitActor(actor, actor);
  const signer = authorizedSigner();
  serviceAssert(
    typeof message === "string" && message.length > 0,
    "release-signoff",
    "The product commit message is missing."
  );
  const identity = {
    name: signer.name,
    email: signer.email,
    date
  };
  return {
    message: `${message}\n\nSigned-off-by: ${identity.name} <${identity.email}>`,
    author: identity,
    committer: identity
  };
}
