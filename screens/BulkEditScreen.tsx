

import React, { useState, useRef } from 'react';
import { Vessel, VesselTank, CalibrationPoint, MeasurementLog, MeasurementOperationType, EquipmentType } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Textarea';
import { Loader2Icon, UploadIcon } from '../components/ui/icons';
import { brToNumber } from '../utils/helpers';
import { Breadcrumb } from '../components/ui/Breadcrumb';

interface BulkEditScreenProps {
    vessels: Vessel[];
    setVessels: React.Dispatch<React.SetStateAction<Vessel[]>>;
    onBack: () => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
}

interface ImportSummary {
    vesselsCreated: number;
    vesselsUpdated: number;
    tanksCreated: number;
    tanksUpdated: number;
    calibrationPointsAdded: number;
    measurementLogsCreated: number;
    errors: string[];
}

export const BulkEditScreen: React.FC<BulkEditScreenProps> = ({ vessels, setVessels, onBack, showToast }) => {
    const [textData, setTextData] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [summary, setSummary] = useState<ImportSummary | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // --- IMPORT LOGIC ---
    const processBalsaLine = (parts: string[], currentVessels: Vessel[], summary: ImportSummary): Vessel[] => {
        const [, externalId, capacity, owner, issueDate, expiryDate, certificateNumber, ...notesParts] = parts;
        const name = externalId; // Assuming name is the same as ID for simplicity from this format
        if (!externalId) {
            summary.errors.push(`Linha BALSA inválida (sem ID): ${parts.join(';')}`);
            return currentVessels;
        }

        const vesselIndex = currentVessels.findIndex(v => v.externalId === externalId);

        if (vesselIndex > -1) { // Update existing
            summary.vesselsUpdated++;
            const updatedVessel = {
                ...currentVessels[vesselIndex],
                name,
                owner,
                issueDate,
                expiryDate,
                certificateNumber: certificateNumber || currentVessels[vesselIndex].certificateNumber,
                totalTheoreticalCapacity: brToNumber(capacity) || currentVessels[vesselIndex].totalTheoreticalCapacity,
                notes: notesParts.join(';').replace(/,/g, ';') || currentVessels[vesselIndex].notes,
                type: 'balsa-tanque' as EquipmentType
            };
            return currentVessels.map((v, i) => i === vesselIndex ? updatedVessel : v);
        } else { // Create new
            summary.vesselsCreated++;
            // FIX: Added missing required property 'executor' to the new Vessel object.
            const newVessel: Vessel = {
                id: Date.now() + Math.random(),
                externalId,
                name,
                owner: owner || '',
                issueDate: issueDate || '',
                expiryDate: expiryDate || '',
                certificateNumber: certificateNumber || '',
                totalTheoreticalCapacity: brToNumber(capacity) || 0,
                notes: notesParts.join(';').replace(/,/g, ';') || '',
                type: 'balsa-tanque',
                executor: '',
                tanks: []
            };
            return [...currentVessels, newVessel];
        }
    };

    const processTankLine = (parts: string[], currentVessels: Vessel[], summary: ImportSummary): Vessel[] => {
        const [, balsaId, tankId, tankName, maxHeight, maxVolume] = parts;
        if (!balsaId || !tankId || !tankName) {
             summary.errors.push(`Linha TANQUE inválida: ${parts.join(';')}`);
             return currentVessels;
        }

        const vesselIndex = currentVessels.findIndex(v => v.externalId === balsaId);
        if (vesselIndex === -1) {
            summary.errors.push(`Balsa com ID ${balsaId} não encontrada para o tanque ${tankId}.`);
            return currentVessels;
        }
        
        const vessel = currentVessels[vesselIndex];
        const tankIndex = vessel.tanks.findIndex(t => t.externalId === tankId);

        let newTanks: VesselTank[];

        if (tankIndex > -1) { // Update existing tank
            summary.tanksUpdated++;
            const updatedTank = {
                ...vessel.tanks[tankIndex],
                tankName,
                maxCalibratedHeight: brToNumber(maxHeight) || vessel.tanks[tankIndex].maxCalibratedHeight,
                maxVolume: brToNumber(maxVolume) || vessel.tanks[tankIndex].maxVolume,
            };
            newTanks = vessel.tanks.map((t, i) => i === tankIndex ? updatedTank : t);
        } else { // Create new tank
            summary.tanksCreated++;
            const newTank: VesselTank = {
                id: Date.now() + Math.random(),
                externalId: tankId,
                tankName,
                maxCalibratedHeight: brToNumber(maxHeight) || 0,
                maxVolume: brToNumber(maxVolume) || 0,
                calibrationCurve: []
            };
            newTanks = [...vessel.tanks, newTank];
        }

        const updatedVessel = { ...vessel, tanks: newTanks };
        return currentVessels.map((v, i) => i === vesselIndex ? updatedVessel : v);
    };
    
    const processCalibracaoLine = (parts: string[], currentVessels: Vessel[], summary: ImportSummary): Vessel[] => {
        const [, tankId, trimStr, heightStr, volumeStr] = parts;
        if (!tankId) {
             summary.errors.push(`Linha CALIBRACAO inválida (sem ID de tanque): ${parts.join(';')}`);
             return currentVessels;
        }

        let vesselIndex = -1;
        let tankIndex = -1;
        let targetVessel: Vessel | undefined;

        for(let i=0; i < currentVessels.length; i++){
            const tIndex = currentVessels[i].tanks.findIndex(t => t.externalId === tankId);
            if(tIndex > -1) {
                vesselIndex = i;
                tankIndex = tIndex;
                targetVessel = currentVessels[i];
                break;
            }
        }
        
        if (!targetVessel) {
            summary.errors.push(`Tanque com ID ${tankId} não encontrado para calibração.`);
            return currentVessels;
        }
        
        const trim = parseInt(trimStr.replace('+', ''), 10);
        const height = brToNumber(heightStr);
        const volume = brToNumber(volumeStr);

        if (isNaN(trim) || isNaN(height) || isNaN(volume)) {
            summary.errors.push(`Dados de calibração inválidos para o tanque ${tankId}: ${parts.join(';')}`);
            return currentVessels;
        }
        
        summary.calibrationPointsAdded++;
        const targetTank = targetVessel.tanks[tankIndex];
        const curve = targetTank.calibrationCurve;
        const pointIndex = curve.findIndex(p => p.trim === trim && p.height === height);

        let newCurve: CalibrationPoint[];
        if(pointIndex > -1) {
            const updatedPoint = { ...curve[pointIndex], volume };
            newCurve = curve.map((p, i) => i === pointIndex ? updatedPoint : p);
        } else {
            newCurve = [...curve, { trim, height, volume }];
        }

        const updatedTank = { ...targetTank, calibrationCurve: newCurve };
        const updatedTanks = targetVessel.tanks.map((t, i) => i === tankIndex ? updatedTank : t);
        const updatedVessel = { ...targetVessel, tanks: updatedTanks };
        
        return currentVessels.map((v, i) => i === vesselIndex ? updatedVessel : v);
    };

    const processMedicaoLinePass1 = (parts: string[], groupedMeasurements: Map<string, any>) => { /* implementation */ };
    const processMedicaoLinePass2 = (groupedMeasurements: Map<string, any>, vessels: Vessel[]): { measurementLogsByVesselId: Record<number, MeasurementLog[]>, count: number } => { /* implementation */ return { measurementLogsByVesselId: {}, count: 0 } };

    const processImportedData = (records: string[]): ImportSummary => { /* implementation */ return { vesselsCreated: 0, vesselsUpdated: 0, tanksCreated: 0, tanksUpdated: 0, calibrationPointsAdded: 0, measurementLogsCreated: 0, errors: [] } };
    
    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target?.result as string;
            setTextData(content);
        };
        reader.readAsText(file);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handleProcess = () => {
        setIsProcessing(true);
        setSummary(null);

        setTimeout(() => {
            const records = textData.split(/(?=BALSA;|TANQUE;|CALIBRACAO;|MEDICAO;)/g).filter(r => r.trim());
            const importSummary = processImportedData(records);
            setSummary(importSummary);
            setIsProcessing(false);
            showToast('Processamento concluído. Verifique o resumo.', importSummary.errors.length > 0 ? 'error' : 'success');
        }, 500);
    };

    const breadcrumbItems = [
        { label: 'Central de Cadastros', onClick: onBack },
        { label: 'Importar em Lote' }
    ];

    return (
        <main className="max-w-8xl mx-auto p-4 md:p-8">
            <Breadcrumb items={breadcrumbItems} />
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight">Importação em Lote de Embarcações</h1>
                <p className="text-muted-foreground">Cole ou envie um arquivo .txt para cadastrar ou atualizar embarcações, tanques e calibrações em massa.</p>
            </div>
            <Card>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                        <Textarea 
                            label="Cole os dados do arquivo TXT aqui"
                            value={textData}
                            onChange={(e) => setTextData(e.target.value)}
                            placeholder="BALSA;JOSEFAMUSTAFA001;85.300;...&#10;TANQUE;JOSEFAMUSTAFA001;...&#10;CALIBRACAO;JOSEFAMUSTAFA001_TQ01BB;+50;0;1062"
                            className="min-h-[400px] font-mono text-xs"
                        />
                         <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".txt,text/plain" className="hidden" multiple />
                         <div className="flex gap-4 mt-4">
                             <Button onClick={handleProcess} disabled={!textData || isProcessing} className="flex-1">
                                {isProcessing ? <Loader2Icon className="h-4 w-4 mr-2"/> : null}
                                {isProcessing ? 'Processando...' : 'Processar Dados'}
                             </Button>
                             <Button variant="secondary" onClick={() => fileInputRef.current?.click()} icon={<UploadIcon className="h-4 w-4"/>}>
                                Carregar Arquivo
                             </Button>
                         </div>
                    </div>
                    <div>
                        <h3 className="text-lg font-semibold mb-4">Resumo da Importação</h3>
                        {summary ? (
                             <div className="space-y-2 text-sm">
                                <p><strong>Embarcações Criadas:</strong> {summary.vesselsCreated}</p>
                                <p><strong>Embarcações Atualizadas:</strong> {summary.vesselsUpdated}</p>
                                <p><strong>Tanques Criados:</strong> {summary.tanksCreated}</p>
                                <p><strong>Tanques Atualizados:</strong> {summary.tanksUpdated}</p>
                                <p><strong>Pontos de Calibração Adicionados/Atualizados:</strong> {summary.calibrationPointsAdded}</p>
                                <p><strong>Registros de Medição Criados:</strong> {summary.measurementLogsCreated}</p>
                                {summary.errors.length > 0 && (
                                    <div className="mt-4 pt-4 border-t">
                                        <h4 className="font-bold text-destructive">Erros ({summary.errors.length}):</h4>
                                        <ul className="list-disc pl-5 mt-2 text-xs text-destructive max-h-48 overflow-y-auto">
                                            {summary.errors.map((err, i) => <li key={i}>{err}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-muted-foreground">O resumo da importação aparecerá aqui após o processamento.</p>
                        )}
                    </div>
                </div>
            </Card>
        </main>
    );
};