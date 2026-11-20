// Netlify Function: POST /api/sms-inbound (Twilio webhook)
import { handleSmsInbound } from "../../lib/handlers.mjs";

export default (request) => handleSmsInbound(request, process.env);
export const config = { path: "/api/sms-inbound" };
