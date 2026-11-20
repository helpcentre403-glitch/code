// Cloudflare Pages Function: POST /api/sms-inbound (Twilio webhook)
import { handleSmsInbound } from "../../lib/handlers.mjs";

export const onRequestPost = ({ request, env }) => handleSmsInbound(request, env);
