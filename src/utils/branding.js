export const FORGETMEAI_WATERMARK = 't.me/forgetmeai';

export function printForgetMeAiWatermark() {
    console.log(`\nForgetMeAI: ${FORGETMEAI_WATERMARK}\n`);
}

export function formatForgetMeAiWatermark(prefix = 'ForgetMeAI') {
    return `${prefix}: ${FORGETMEAI_WATERMARK}`;
}
