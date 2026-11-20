// Cloudflare Pages Function: POST /api/lead
import { handleLead } from "../../lib/handlers.mjs";

export const onRequestPost = ({ request, env }) => handleLead(request, env);
