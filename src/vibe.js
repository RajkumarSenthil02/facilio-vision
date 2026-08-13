import { createVibe } from '@facilio/vibe-sdk';

// serverURL defaults to window.location.origin — the deployed app is served from
// the same origin as the API, so cookies flow without any config.
export const vibe = createVibe();
