interface PipelineWatchers {
    rollbackWorkflowId: string;
    autoAcceptWorkflowIds: string[];
    failurePropagationId: string;
    childSettledNotificationId: string;
}
export declare function registerPipelineWatcher(pipelineId: string, deadlineUnix: number, stepCount: number, solaceAddress: string, chainId: number, parentPipelineId?: string, parentStepIndex?: number): Promise<PipelineWatchers>;
export declare function cancelWatchers(watchers: PipelineWatchers): Promise<void>;
export declare function sendSponsoredTransaction(contractAddress: string, functionName: string, functionArgs: any[], abi: any, value?: string): Promise<string>;
export {};
