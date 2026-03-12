import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Database, Loader2, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import {
  TRAINING_LR_SCHEDULER_VALUES,
  trainingHyperparamsSchema as sharedTrainingHyperparamsSchema,
  type TrainingHyperparams,
  type TrainingLrSchedulerType,
} from '../../../../../../packages/shared-utils/src/training-config';
import {
  buildTrainingIdempotencyFingerprint,
  generateTrainingIdempotencyKey,
  getRetryAfterHint,
  type TrainingTranslationFn,
} from '../training-request-utils';

type TrainingHyperparamsPreset = 'safe' | 'standard' | 'large';

type NamespaceOption = {
  id: string;
  nome: string;
};

type TrainingCreateJobDialogProps = {
  approvedCount: number;
  defaultHyperparams: TrainingHyperparams;
  minRequiredApprovedData: number;
  namespaceId: string;
  namespaces: NamespaceOption[];
  onClose: () => void;
  onNamespaceIdChange: (value: string) => void;
  open: boolean;
  presetHyperparams: Record<TrainingHyperparamsPreset, TrainingHyperparams>;
  t: TrainingTranslationFn;
  tenantId: string | undefined;
};

export function TrainingCreateJobDialog({
  approvedCount,
  defaultHyperparams,
  minRequiredApprovedData,
  namespaceId,
  namespaces,
  onClose,
  onNamespaceIdChange,
  open,
  presetHyperparams,
  t,
  tenantId,
}: TrainingCreateJobDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<TrainingHyperparamsPreset>('standard');
  const [advancedOverride, setAdvancedOverride] = useState(false);
  const [epochs, setEpochs] = useState(defaultHyperparams.epochs);
  const [batchSize, setBatchSize] = useState(defaultHyperparams.batchSize);
  const [learningRate, setLearningRate] = useState(defaultHyperparams.learningRate);
  const [gradientAccumulationSteps, setGradientAccumulationSteps] = useState(defaultHyperparams.gradientAccumulationSteps);
  const [warmupSteps, setWarmupSteps] = useState(defaultHyperparams.warmupSteps);
  const [maxSeqLen, setMaxSeqLen] = useState(defaultHyperparams.maxSeqLen);
  const [loraRank, setLoraRank] = useState(defaultHyperparams.loraRank);
  const [loraAlpha, setLoraAlpha] = useState(defaultHyperparams.loraAlpha);
  const [loraDropout, setLoraDropout] = useState(defaultHyperparams.loraDropout);
  const [lrSchedulerType, setLrSchedulerType] = useState<TrainingLrSchedulerType>(defaultHyperparams.lrSchedulerType);
  const [maxGradNorm, setMaxGradNorm] = useState(defaultHyperparams.maxGradNorm);
  const [targetModulesInput, setTargetModulesInput] = useState(defaultHyperparams.targetModules.join(','));
  const createJobIdempotencyRef = useRef<{ fingerprint: string; key: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    const presetValues = presetHyperparams[preset] ?? defaultHyperparams;
    setEpochs(presetValues.epochs);
    setBatchSize(presetValues.batchSize);
    setLearningRate(presetValues.learningRate);
    setGradientAccumulationSteps(presetValues.gradientAccumulationSteps);
    setWarmupSteps(presetValues.warmupSteps);
    setMaxSeqLen(presetValues.maxSeqLen);
    setLoraRank(presetValues.loraRank);
    setLoraAlpha(presetValues.loraAlpha);
    setLoraDropout(presetValues.loraDropout);
    setLrSchedulerType(presetValues.lrSchedulerType);
    setMaxGradNorm(presetValues.maxGradNorm);
    setTargetModulesInput(presetValues.targetModules.join(','));
  }, [defaultHyperparams, open, preset, presetHyperparams]);

  useEffect(() => {
    if (!open) {
      createJobIdempotencyRef.current = null;
    }
  }, [open]);

  const createJob = useMutation({
    mutationFn: async () => {
      if (!namespaceId || !tenantId) {
        throw new Error(t('training.createJob.namespaceRequired'));
      }

      const presetValues = presetHyperparams[preset] ?? defaultHyperparams;
      const parsed = sharedTrainingHyperparamsSchema.safeParse({
        ...presetValues,
        epochs,
        batchSize,
        learningRate,
        ...(advancedOverride
          ? {
            gradientAccumulationSteps,
            warmupSteps,
            maxSeqLen,
            loraRank,
            loraAlpha,
            loraDropout,
            lrSchedulerType,
            maxGradNorm,
            targetModules: targetModulesInput
              .split(',')
              .map((moduleName) => moduleName.trim())
              .filter((moduleName) => moduleName.length > 0),
          }
          : {}),
      });
      if (!parsed.success) {
        throw new Error(t('training.createJob.invalidHyperparams'));
      }
      const validatedHyperparams = parsed.data;
      const requestPayload = {
        tenantId,
        namespaceId,
        name,
        hyperparametersPreset: preset,
        hyperparameters: validatedHyperparams,
      };
      const fingerprint = buildTrainingIdempotencyFingerprint(requestPayload);
      const idempotencyKey = createJobIdempotencyRef.current?.fingerprint === fingerprint
        ? createJobIdempotencyRef.current.key
        : generateTrainingIdempotencyKey('training-job');
      createJobIdempotencyRef.current = { fingerprint, key: idempotencyKey };

      return apiRequest('POST', '/api/training/jobs', requestPayload, {
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/training/jobs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/training/data'] });
      toast({ title: t('training.success.jobCreated') });
      onClose();
      setName('');
      setPreset('standard');
      setAdvancedOverride(false);
      createJobIdempotencyRef.current = null;
    },
    onError: (error) => {
      const retryAfterHint = getRetryAfterHint(error, t);
      toast({
        title: error instanceof Error ? error.message : t('training.errors.createJob'),
        description: retryAfterHint ?? undefined,
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {t('training.createJob.title')}
          </DialogTitle>
          <DialogDescription>
            {t('training.createJob.description')}
            {approvedCount < minRequiredApprovedData && (
              <span className="mt-2 block text-amber-600">
                {t('training.createJob.minDataWarning', {
                  count: approvedCount,
                  min: minRequiredApprovedData,
                })}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('training.createJob.namespaceLabel')}</Label>
            <Select value={namespaceId} onValueChange={onNamespaceIdChange}>
              <SelectTrigger data-testid="select-job-namespace">
                <SelectValue placeholder={t('training.createJob.namespacePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {namespaces.map((namespace) => (
                  <SelectItem key={namespace.id} value={namespace.id}>
                    {namespace.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('training.createJob.namespaceHelp')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">{t('training.createJob.nameLabel')}</Label>
            <Input
              id="name"
              placeholder={t('training.createJob.namePlaceholder')}
              value={name}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
              data-testid="input-job-name"
            />
          </div>

          <div className="grid gap-2">
            <Label>{t('training.createJob.presetLabel')}</Label>
            <Select value={preset} onValueChange={(value) => setPreset(value as TrainingHyperparamsPreset)}>
              <SelectTrigger data-testid="select-hyperparams-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="safe">{t('training.createJob.presetSafe')}</SelectItem>
                <SelectItem value="standard">{t('training.createJob.presetStandard')}</SelectItem>
                <SelectItem value="large">{t('training.createJob.presetLarge')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">{t('training.createJob.advancedOverride')}</p>
              <p className="text-xs text-muted-foreground">{t('training.createJob.advancedOverrideDesc')}</p>
            </div>
            <Switch checked={advancedOverride} onCheckedChange={setAdvancedOverride} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="epochs">{t('training.createJob.epochs')}</Label>
              <Input
                id="epochs"
                type="number"
                min={1}
                max={50}
                value={epochs}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEpochs(Number(event.target.value))}
                data-testid="input-epochs"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="batchSize">{t('training.createJob.batchSize')}</Label>
              <Input
                id="batchSize"
                type="number"
                min={1}
                max={64}
                value={batchSize}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setBatchSize(Number(event.target.value))}
                data-testid="input-batch-size"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lr">{t('training.createJob.learningRate')}</Label>
              <Input
                id="lr"
                type="number"
                step={0.00001}
                min={0.00001}
                max={0.99999}
                value={learningRate}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLearningRate(Number(event.target.value))}
                data-testid="input-learning-rate"
              />
            </div>
          </div>

          {advancedOverride && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="gradientAccumulationSteps">{t('training.createJob.gradientAccumulationSteps')}</Label>
                <Input
                  id="gradientAccumulationSteps"
                  type="number"
                  min={1}
                  max={128}
                  value={gradientAccumulationSteps}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGradientAccumulationSteps(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warmupSteps">{t('training.createJob.warmupSteps')}</Label>
                <Input
                  id="warmupSteps"
                  type="number"
                  min={0}
                  max={10000}
                  value={warmupSteps}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setWarmupSteps(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxSeqLen">{t('training.createJob.maxSeqLen')}</Label>
                <Input
                  id="maxSeqLen"
                  type="number"
                  min={256}
                  max={32768}
                  value={maxSeqLen}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMaxSeqLen(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loraRank">{t('training.createJob.loraRank')}</Label>
                <Input
                  id="loraRank"
                  type="number"
                  min={4}
                  max={128}
                  value={loraRank}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLoraRank(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loraAlpha">{t('training.createJob.loraAlpha')}</Label>
                <Input
                  id="loraAlpha"
                  type="number"
                  min={8}
                  max={256}
                  value={loraAlpha}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLoraAlpha(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="loraDropout">{t('training.createJob.loraDropout')}</Label>
                <Input
                  id="loraDropout"
                  type="number"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={loraDropout}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setLoraDropout(Number(event.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('training.createJob.lrSchedulerType')}</Label>
                <Select
                  value={lrSchedulerType}
                  onValueChange={(value) => setLrSchedulerType(value as TrainingLrSchedulerType)}
                >
                  <SelectTrigger data-testid="select-lr-scheduler-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAINING_LR_SCHEDULER_VALUES.map((schedulerType) => (
                      <SelectItem key={schedulerType} value={schedulerType}>
                        {schedulerType}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxGradNorm">{t('training.createJob.maxGradNorm')}</Label>
                <Input
                  id="maxGradNorm"
                  type="number"
                  min={0.01}
                  max={100}
                  step={0.01}
                  value={maxGradNorm}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setMaxGradNorm(Number(event.target.value))}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="targetModules">{t('training.createJob.targetModules')}</Label>
                <Input
                  id="targetModules"
                  value={targetModulesInput}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setTargetModulesInput(event.target.value)}
                  placeholder="q_proj,v_proj"
                />
                <p className="text-xs text-muted-foreground">{t('training.createJob.targetModulesDesc')}</p>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4 text-primary" />
              <span>{t('training.createJob.approvedData', { count: approvedCount })}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-job">
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => createJob.mutate()}
            disabled={!namespaceId || !tenantId || !name || approvedCount < minRequiredApprovedData || createJob.isPending}
            data-testid="button-create-job"
          >
            {createJob.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {t('training.createJob.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
