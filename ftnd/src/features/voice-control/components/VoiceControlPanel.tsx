'use client';

import { useState } from 'react';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import { Alert, Button, Snackbar } from '@mui/material';

export default function VoiceControlPanel() {
  const [showPendingNotice, setShowPendingNotice] = useState(false);

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<MicRoundedIcon />}
        onClick={() => setShowPendingNotice(true)}
        className="voice-input-button"
      >
        语音输入
      </Button>

      <Snackbar
        open={showPendingNotice}
        autoHideDuration={2600}
        onClose={() => setShowPendingNotice(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="info"
          onClose={() => setShowPendingNotice(false)}
        >
          语音识别服务将在后续接入。
        </Alert>
      </Snackbar>
    </>
  );
}
