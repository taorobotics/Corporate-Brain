import { useState } from "react";
import { Modal } from "./components";
import privacy from "../docs/PRIVACY.md?raw";
import license from "../LICENSE?raw";
import notices from "../THIRD_PARTY_NOTICES.txt?raw";
import signing from "../docs/CODE_SIGNING_POLICY.md?raw";
const documents = [
  ["隐私说明", privacy],
  ["开源许可", license],
  ["第三方组件", notices],
  ["签名政策", signing],
];
export default function Legal({ close }: { close: () => void }) {
  const [selected, select] = useState(0);
  return (
    <Modal title="隐私与许可" close={close} wide>
      <nav className="legal-tabs" aria-label="隐私与许可分类">
        {documents.map(([title], index) => (
          <button
            key={title}
            aria-pressed={selected === index}
            onClick={() => select(index)}
          >
            {title}
          </button>
        ))}
      </nav>
      <article className="legal-document" aria-label={documents[selected][0]}>
        {documents[selected][1]}
      </article>
    </Modal>
  );
}
