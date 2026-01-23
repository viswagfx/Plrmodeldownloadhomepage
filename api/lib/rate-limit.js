const rateLimit = new Map();

// Helper to get IP from request
export function getIp(req) {
    // Check standard headers for proxy/load balancer
    const forwarded = req.headers["x-forwarded-for"];
    const realIp = req.headers["x-real-ip"];

    if (forwarded) {
        // x-forwarded-for can be a comma-separated list, first one is the client
        return forwarded.split(",")[0].trim();
    }

    if (realIp) {
        return realIp.trim();
    }

    // Fallback to socket address (dev/local)
    return req.socket?.remoteAddress || "unknown";
}

export function checkRateLimit(req) {
    const ip = getIp(req);

    // Allow localhost (optional, but good for dev)
    if (ip === "127.0.0.1" || ip === "::1") return true;

    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const maxReqs = 20; // 20 requests per minute

    const record = rateLimit.get(ip) || { count: 0, startTime: now };

    // Reset if window passed
    if (now - record.startTime > windowMs) {
        record.count = 1;
        record.startTime = now;
    } else {
        record.count++;
    }

    rateLimit.set(ip, record);

    // Clean up old entries periodically (simple garbage collection)
    if (rateLimit.size > 5000) {
        for (const [key, val] of rateLimit.entries()) {
            if (now - val.startTime > windowMs) {
                rateLimit.delete(key);
            }
        }
    }

    return record.count <= maxReqs;
}
