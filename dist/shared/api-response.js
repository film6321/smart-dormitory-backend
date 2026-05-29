"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createResponse = createResponse;
function createResponse(statusCode, message, data) {
    return { statusCode, message, data };
}
