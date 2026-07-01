"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateSimpleObject = void 0;
const validateSimpleObject = (schema, input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return [{ property: 'body', constraints: { isObject: 'Body must be an object' } }];
    }
    const entries = Object.entries(schema);
    const errors = [];
    for (const [property, validator] of entries) {
        const value = input[property];
        if (!validator(value)) {
            errors.push({ property, constraints: { isValid: `${property} is invalid` } });
        }
    }
    return errors;
};
exports.validateSimpleObject = validateSimpleObject;
