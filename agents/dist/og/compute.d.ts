interface InferenceResult {
    output: string;
    verified: boolean;
    provider: string;
}
export declare function callOGCompute(systemPrompt: string, userPrompt: string, maxRetries?: number): Promise<InferenceResult>;
export {};
