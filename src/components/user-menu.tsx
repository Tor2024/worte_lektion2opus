
'use client';

import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Settings, AlertCircle, RotateCcw, Download, Upload, Database } from 'lucide-react';
import { storage } from '@/lib/storage';
import { useState } from 'react';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";

export function UserMenu() {
    const [confirmStep, setConfirmStep] = useState(0);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const { settings, updateSettings } = useSettings();

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const success = await storage.importData(file);
        setIsImporting(false);

        if (!success) {
            alert("Ошибка импорта! Файл поврежден или имеет неверный формат.");
        }
        // If successful, storage.importData will reload the page
    };

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                        <Avatar className="h-8 w-8 border">
                            <AvatarImage src="/avatars/01.png" alt="@user" />
                            <AvatarFallback>L</AvatarFallback>
                        </Avatar>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                            <p className="text-sm font-medium leading-none">
                                Local User
                            </p>
                            <p className="text-xs leading-none text-muted-foreground flex items-center gap-1 mt-1">
                                <Database className="h-3 w-3" />
                                {storage.getActiveEngine() === 'IndexedDB' ? 'IndexedDB (Безлимитно)' : 'LocalStorage (Ограничено)'}
                            </p>
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                        <User className="mr-2 h-4 w-4" />
                        <span>Профиль</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault();
                            setIsSettingsOpen(true);
                        }}
                    >
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Настройки</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer"
                        onSelect={(e) => {
                            e.preventDefault();
                            setConfirmStep(1);
                        }}
                    >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        <span>Сброс прогресса</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            {/* First Confirmation */}
            <AlertDialog open={confirmStep === 1} onOpenChange={(open) => !open && setConfirmStep(0)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Вы уверены?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Это сбросит весь прогресс обучения, включая уровни владения словами и статистику сессий.
                            Ваши папки и слова останутся, но они снова станут "новыми" для изучения.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => setConfirmStep(2)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Да, продолжить
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Second Confirmation */}
            <AlertDialog open={confirmStep === 2} onOpenChange={(open) => !open && setConfirmStep(0)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-destructive flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            Окончательное подтверждение
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Это действие невозможно отменить. Вы действительно хотите полностью сбросить свой прогресс и начать сначала?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Я передумал</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => storage.resetAllProgress()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            СБРОСИТЬ ВСЁ
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Settings Dialog */}
            <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Настройки приложения</DialogTitle>
                        <DialogDescription>
                            Персонализируйте свой процесс обучения.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        <Label className="text-sm font-bold block mb-4">Письменная тренировка (Фаза 3)</Label>
                        <RadioGroup
                            value={settings.productionMode}
                            onValueChange={(value: 'full' | 'cloze' | 'skip') => updateSettings({ productionMode: value })}
                            className="space-y-4"
                        >
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem value="full" id="mode-full" className="mt-1" />
                                <Label htmlFor="mode-full" className="flex flex-col gap-1 cursor-pointer">
                                    <span className="font-bold">Полное вписывание</span>
                                    <span className="font-normal text-xs text-muted-foreground leading-relaxed">
                                        Строгая проверка артиклей, окончаний и заглавных букв. Максимальное закрепление.
                                    </span>
                                </Label>
                            </div>
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem value="cloze" id="mode-cloze" className="mt-1" />
                                <Label htmlFor="mode-cloze" className="flex flex-col gap-1 cursor-pointer">
                                    <span className="font-bold flex items-center gap-2">
                                        Режим "Тень" <span className="bg-amber-100 text-amber-800 text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider">Быстро</span>
                                    </span>
                                    <span className="font-normal text-xs text-muted-foreground leading-relaxed">
                                        Вписывание слова в контексте. Прощает мелкие ошибки в артиклях и окончаниях.
                                    </span>
                                </Label>
                            </div>
                            <div className="flex items-start space-x-3">
                                <RadioGroupItem value="skip" id="mode-skip" className="mt-1" />
                                <Label htmlFor="mode-skip" className="flex flex-col gap-1 cursor-pointer">
                                    <span className="font-bold text-slate-500">Пропуск фазы</span>
                                    <span className="font-normal text-xs text-muted-foreground leading-relaxed">
                                        Слова автоматически засчитываются выученными после чтения истории.
                                    </span>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>

                    <div className="py-2 border-t mt-2 pt-4">
                        <Label className="text-sm font-bold block mb-3">Режим распознавания</Label>
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex flex-col gap-1 flex-1">
                                <span className="font-bold text-sm flex items-center gap-2">
                                    Аудио-первый режим
                                    <span className="bg-indigo-100 text-indigo-800 text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider">B1+</span>
                                </span>
                                <span className="font-normal text-xs text-muted-foreground leading-relaxed">
                                    В фазе распознавания сначала звучит слово, а написание скрыто до выбора ответа — тренирует слуховое извлечение из памяти.
                                </span>
                            </div>
                            <Switch
                                checked={!!settings.audioFirst}
                                onCheckedChange={(checked) => updateSettings({ audioFirst: checked })}
                                aria-label="Аудио-первый режим"
                            />
                        </div>
                    </div>

                    <div className="py-2 border-t mt-2 pt-4">
                        <Label className="text-sm font-bold block mb-4">Управление данными</Label>
                        <div className="flex flex-col gap-3">
                            <Button
                                variant="outline"
                                className="w-full justify-start text-left font-normal"
                                onClick={() => storage.exportData()}
                            >
                                <Download className="mr-2 h-4 w-4" />
                                <div>
                                    <div className="font-bold">Скачать резервную копию</div>
                                    <div className="text-xs text-muted-foreground">Сохранить прогресс в .json файл</div>
                                </div>
                            </Button>

                            <div className="relative">
                                <Button
                                    variant="outline"
                                    className="w-full justify-start text-left font-normal"
                                    disabled={isImporting}
                                >
                                    <Upload className="mr-2 h-4 w-4" />
                                    <div>
                                        <div className="font-bold">{isImporting ? 'Загрузка...' : 'Восстановить из файла'}</div>
                                        <div className="text-xs text-muted-foreground">Загрузить ранее скачанный .json файл</div>
                                    </div>
                                </Button>
                                <input
                                    type="file"
                                    accept=".json,application/json"
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    onChange={handleImport}
                                    disabled={isImporting}
                                />
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
