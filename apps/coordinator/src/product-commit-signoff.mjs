import { serviceAssert } from "./service-contract.mjs";

// The acting account explicitly authorized its DCO attestation for commits
// created by the Coordinator in the real product repositories. This does not
// sign source commits submitted by other developers.
const authorizedSigner = Object.freeze({
  id: "209783236",
  login: "simo6529",
  name: "Simo",
  email: "209783236+simo6529@users.noreply.github.com"
});

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
    email: authorizedSigner.email,
    date
  };
  return {
    message: `${message}\n\nSigned-off-by: ${identity.name} <${identity.email}>`,
    author: identity,
    committer: identity
  };
}
