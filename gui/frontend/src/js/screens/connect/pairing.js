// Phone pairing card: the QR code and the controller address (both from Go).

import { $, setText, setAttr } from '../../core/dom.js';
import { onState } from '../../core/state.js';

export function startPairing() {
  onState((st) => {
    if (st.qrCode) setAttr($('pair-qr'), 'src', st.qrCode);
    if (st.gamepadUrl) setText($('pair-url'), st.gamepadUrl);
  });
}
