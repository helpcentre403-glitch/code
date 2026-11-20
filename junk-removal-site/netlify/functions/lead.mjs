// Netlify Function: POST /api/lead
import { handleLead } from "../../lib/handlers.mjs";

export default (request) => handleLead(request, process.env);
export const config = { path: "/api/lead" };
