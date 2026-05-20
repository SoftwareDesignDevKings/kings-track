import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Card,
  CardContent,
  LinearProgress,
  Stepper,
  Step,
  StepLabel,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  TextField,
  Divider,
} from '@mui/material';
import {
  CloudUpload as UploadIcon,
  CheckCircle as CheckCircleIcon,
  Description as FileIcon,
  FolderOpen as FolderIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Refresh as RefreshIcon,
  School as SchoolIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { apiService } from '../services/api';

interface WatcherStatus {
  running: boolean;
  watchFolder: string;
  processedFolder: string;
  filesProcessedToday: number;
  totalFilesProcessed: number;
  lastImportTime: string | null;
  lastImportFile: string | null;
}

interface HistoryEntry {
  fileName: string;
  timestamp: string;
  success: boolean;
  meetingTitle: string;
  recordsImported: number;
  error?: string;
}

const SyncPage: React.FC = () => {
  // Manual import state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<any>(null);

  // Watcher state
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null);
  const [watcherHistory, setWatcherHistory] = useState<HistoryEntry[]>([]);
  const [watcherLoading, setWatcherLoading] = useState(false);
  const [watcherError, setWatcherError] = useState<string | null>(null);
  const [folderInput, setFolderInput] = useState('');
  const [editingFolder, setEditingFolder] = useState(false);

  // Canvas state
  const [canvasStatus, setCanvasStatus] = useState<any>(null);
  const [canvasCourses, setCanvasCourses] = useState<any[]>([]);
  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);

  const steps = ['Select CSV File', 'Importing Data', 'Complete'];

  // Fetch watcher status
  const fetchWatcherStatus = useCallback(async () => {
    try {
      const status = await apiService.getWatcherStatus();
      setWatcherStatus(status);
      setFolderInput(status.watchFolder);
    } catch (err: any) {
      console.error('Failed to fetch watcher status:', err);
    }
  }, []);

  // Fetch watcher history
  const fetchWatcherHistory = useCallback(async () => {
    try {
      const history = await apiService.getWatcherHistory(20);
      setWatcherHistory(history);
    } catch (err: any) {
      console.error('Failed to fetch watcher history:', err);
    }
  }, []);

  // Fetch Canvas status
  const fetchCanvasStatus = useCallback(async () => {
    try {
      const status = await apiService.getCanvasStatus();
      setCanvasStatus(status);
    } catch (err: any) {
      console.error('Failed to fetch canvas status:', err);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    fetchWatcherStatus();
    fetchWatcherHistory();
    fetchCanvasStatus();

    // Poll every 5 seconds for live updates
    const interval = setInterval(() => {
      fetchWatcherStatus();
      fetchWatcherHistory();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchWatcherStatus, fetchWatcherHistory, fetchCanvasStatus]);

  // Watcher controls
  const handleStartWatcher = async () => {
    try {
      setWatcherLoading(true);
      setWatcherError(null);
      await apiService.startWatcher();
      await fetchWatcherStatus();
    } catch (err: any) {
      setWatcherError(err.response?.data?.message || 'Failed to start watcher');
    } finally {
      setWatcherLoading(false);
    }
  };

  const handleStopWatcher = async () => {
    try {
      setWatcherLoading(true);
      setWatcherError(null);
      await apiService.stopWatcher();
      await fetchWatcherStatus();
    } catch (err: any) {
      setWatcherError(err.response?.data?.message || 'Failed to stop watcher');
    } finally {
      setWatcherLoading(false);
    }
  };

  const handleUpdateFolder = async () => {
    try {
      setWatcherLoading(true);
      setWatcherError(null);
      await apiService.updateWatcherConfig({ watchFolder: folderInput });
      await fetchWatcherStatus();
      setEditingFolder(false);
    } catch (err: any) {
      setWatcherError(err.response?.data?.message || 'Failed to update folder');
    } finally {
      setWatcherLoading(false);
    }
  };

  // Canvas sync handler
  const handleCanvasSyncAll = async () => {
    try {
      setCanvasSyncing(true);
      setCanvasError(null);
      setCanvasMessage(null);
      const result = await apiService.syncAllCanvasRosters();
      setCanvasMessage(result.message);
      await fetchCanvasStatus();
    } catch (err: any) {
      setCanvasError(err.response?.data?.message || 'Failed to sync Canvas rosters');
    } finally {
      setCanvasSyncing(false);
    }
  };

  // Manual import handlers
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.csv')) {
        setError('Please select a CSV file');
        return;
      }
      setSelectedFile(file);
      setError(null);
      setActiveStep(0);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      setError('Please select a CSV file');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);
      setActiveStep(1);

      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await apiService.importAttendanceCSV(formData);

      setImportResult(response.data);
      setSuccess(response.message);
      setActiveStep(2);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to import CSV');
      setActiveStep(0);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setActiveStep(0);
    setSuccess(null);
    setError(null);
    setSelectedFile(null);
    setImportResult(null);
  };

  return (
    <Box>
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Import Attendance Data
      </Typography>
      <Typography variant="body1" color="textSecondary" paragraph>
        Automatically import attendance when you download reports from Teams, or manually upload CSV files.
      </Typography>

      {/* Folder Watcher Section */}
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FolderIcon color="primary" />
            <Typography variant="h6">
              Auto-Import (Folder Watcher)
            </Typography>
          </Box>
          <Chip
            label={watcherStatus?.running ? 'Active' : 'Stopped'}
            color={watcherStatus?.running ? 'success' : 'default'}
            size="small"
          />
        </Box>

        <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
          When active, the app watches a folder on your computer. Download an attendance report from
          Teams and it will be imported automatically.
        </Typography>

        {watcherError && (
          <Alert severity="error" onClose={() => setWatcherError(null)} sx={{ mb: 2 }}>
            {watcherError}
          </Alert>
        )}

        {/* Watch folder path */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight="bold" gutterBottom>
            Watched Folder:
          </Typography>
          {editingFolder ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField
                size="small"
                fullWidth
                value={folderInput}
                onChange={(e) => setFolderInput(e.target.value)}
                placeholder="e.g., ~/Downloads"
              />
              <Button size="small" variant="contained" onClick={handleUpdateFolder} disabled={watcherLoading}>
                Save
              </Button>
              <Button size="small" onClick={() => setEditingFolder(false)}>
                Cancel
              </Button>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ fontFamily: 'monospace', bgcolor: 'grey.100', px: 1, py: 0.5, borderRadius: 1 }}>
                {watcherStatus?.watchFolder || 'Not configured'}
              </Typography>
              <Button size="small" onClick={() => setEditingFolder(true)}>
                Change
              </Button>
            </Stack>
          )}
        </Box>

        {/* Watcher controls */}
        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          {watcherStatus?.running ? (
            <Button
              variant="outlined"
              color="error"
              startIcon={<StopIcon />}
              onClick={handleStopWatcher}
              disabled={watcherLoading}
              size="small"
            >
              Stop Watching
            </Button>
          ) : (
            <Button
              variant="contained"
              color="success"
              startIcon={<PlayIcon />}
              onClick={handleStartWatcher}
              disabled={watcherLoading}
              size="small"
            >
              Start Watching
            </Button>
          )}
          <Button
            variant="text"
            startIcon={<RefreshIcon />}
            onClick={() => { fetchWatcherStatus(); fetchWatcherHistory(); }}
            size="small"
          >
            Refresh
          </Button>
        </Stack>

        {/* Stats */}
        {watcherStatus && (
          <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
            <Box>
              <Typography variant="caption" color="textSecondary">Files Today</Typography>
              <Typography variant="h6">{watcherStatus.filesProcessedToday}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="textSecondary">Total Processed</Typography>
              <Typography variant="h6">{watcherStatus.totalFilesProcessed}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="textSecondary">Last Import</Typography>
              <Typography variant="body2">
                {watcherStatus.lastImportTime
                  ? new Date(watcherStatus.lastImportTime).toLocaleString()
                  : 'None yet'}
              </Typography>
            </Box>
          </Stack>
        )}

        {/* Recent history */}
        {watcherHistory.length > 0 && (
          <Box>
            <Typography variant="body2" fontWeight="bold" gutterBottom>
              Recent Imports:
            </Typography>
            <TableContainer sx={{ maxHeight: 200 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Time</TableCell>
                    <TableCell>Meeting</TableCell>
                    <TableCell>Records</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {watcherHistory.slice(0, 10).map((entry, idx) => (
                    <TableRow key={idx}>
                      <TableCell sx={{ fontSize: '0.75rem' }}>
                        {new Date(entry.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>
                        {entry.meetingTitle || entry.fileName}
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.75rem' }}>
                        {entry.recordsImported}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={entry.success ? 'OK' : 'Error'}
                          color={entry.success ? 'success' : 'error'}
                          size="small"
                          variant="outlined"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* Instructions */}
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight="bold" gutterBottom>
            How to use:
          </Typography>
          <Box component="ol" sx={{ pl: 2, mb: 0, '& li': { mb: 0.5 } }}>
            <li>Start the folder watcher (above)</li>
            <li>After a Teams meeting ends, open the meeting chat</li>
            <li>Click the <strong>Attendance</strong> tab, then <strong>Download</strong></li>
            <li>Save the file to your watched folder ({watcherStatus?.watchFolder || '~/Downloads'})</li>
            <li>The attendance data appears in your dashboard automatically</li>
          </Box>
        </Alert>
      </Paper>

      {/* Canvas Integration Section */}
      {canvasStatus?.configured && (
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <SchoolIcon color="secondary" />
              <Typography variant="h6">
                Canvas Class Rosters
              </Typography>
            </Box>
            <Chip
              label="Connected"
              color="success"
              size="small"
              variant="outlined"
            />
          </Box>

          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Sync student rosters from Canvas to identify absent students.
            Only online/external classes (with X in the code) are synced.
          </Typography>

          {canvasError && (
            <Alert severity="error" onClose={() => setCanvasError(null)} sx={{ mb: 2 }}>
              {canvasError}
            </Alert>
          )}

          {canvasMessage && (
            <Alert severity="success" onClose={() => setCanvasMessage(null)} sx={{ mb: 2 }}>
              {canvasMessage}
            </Alert>
          )}

          <Button
            variant="contained"
            color="secondary"
            startIcon={canvasSyncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
            onClick={handleCanvasSyncAll}
            disabled={canvasSyncing}
            sx={{ mb: 2 }}
          >
            {canvasSyncing ? 'Syncing...' : 'Sync All Class Rosters'}
          </Button>

          {/* Synced classes summary */}
          {canvasStatus?.synced_classes?.length > 0 && (
            <Box>
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Synced Classes:
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {canvasStatus.synced_classes.map((cls: any) => (
                  <Chip
                    key={cls.class_code}
                    label={`${cls.class_code} (${cls.student_count} students)`}
                    size="small"
                    variant="outlined"
                    color="secondary"
                  />
                ))}
              </Stack>
            </Box>
          )}
        </Paper>
      )}

      <Divider sx={{ my: 3 }} />

      {/* Manual Import Section */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Manual CSV Upload
          </Typography>
          <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
            Upload a Teams attendance CSV file manually as a fallback.
          </Typography>

          <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {error && (
            <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" onClose={() => setSuccess(null)} sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}

          {activeStep === 0 && (
            <Box>
              <input
                accept=".csv"
                style={{ display: 'none' }}
                id="csv-file-upload"
                type="file"
                onChange={handleFileSelect}
              />
              <label htmlFor="csv-file-upload">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<UploadIcon />}
                  fullWidth
                  size="large"
                  sx={{ mb: 2 }}
                >
                  Select CSV File
                </Button>
              </label>

              {selectedFile && (
                <Alert severity="info" icon={<FileIcon />} sx={{ mb: 2 }}>
                  <strong>Selected file:</strong> {selectedFile.name} (
                  {(selectedFile.size / 1024).toFixed(2)} KB)
                </Alert>
              )}

              <Button
                variant="contained"
                size="large"
                startIcon={<UploadIcon />}
                onClick={handleImport}
                disabled={!selectedFile || loading}
                fullWidth
              >
                {loading ? 'Importing...' : 'Import Attendance Data'}
              </Button>
            </Box>
          )}

          {activeStep === 1 && (
            <Box textAlign="center" py={4}>
              <CircularProgress size={60} />
              <Typography variant="h6" sx={{ mt: 2 }}>
                Importing attendance data...
              </Typography>
              <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                Processing CSV file and creating records
              </Typography>
              <LinearProgress sx={{ mt: 3 }} />
            </Box>
          )}

          {activeStep === 2 && importResult && (
            <Box>
              <Box textAlign="center" py={2}>
                <CheckCircleIcon color="success" sx={{ fontSize: 80 }} />
                <Typography variant="h6" sx={{ mt: 2 }}>
                  Import Complete!
                </Typography>
              </Box>

              <TableContainer>
                <Table size="small">
                  <TableBody>
                    <TableRow>
                      <TableCell>
                        <strong>Meetings Created:</strong>
                      </TableCell>
                      <TableCell align="right">{importResult.meetings}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>
                        <strong>Students Created:</strong>
                      </TableCell>
                      <TableCell align="right">{importResult.students}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>
                        <strong>Attendance Records Imported:</strong>
                      </TableCell>
                      <TableCell align="right">{importResult.imported}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>
                        <strong>Records Skipped (duplicates):</strong>
                      </TableCell>
                      <TableCell align="right">{importResult.skipped}</TableCell>
                    </TableRow>
                    {importResult.errors && importResult.errors.length > 0 && (
                      <TableRow>
                        <TableCell>
                          <strong>Errors:</strong>
                        </TableCell>
                        <TableCell align="right">{importResult.errors.length}</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {importResult.errors && importResult.errors.length > 0 && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <Typography variant="body2" fontWeight="bold" gutterBottom>
                    Import completed with errors:
                  </Typography>
                  <Box component="ul" sx={{ pl: 2, mt: 1, mb: 0 }}>
                    {importResult.errors.slice(0, 5).map((err: string, idx: number) => (
                      <Typography component="li" variant="caption" key={idx}>
                        {err}
                      </Typography>
                    ))}
                    {importResult.errors.length > 5 && (
                      <Typography component="li" variant="caption">
                        ... and {importResult.errors.length - 5} more
                      </Typography>
                    )}
                  </Box>
                </Alert>
              )}

              <Button variant="outlined" onClick={handleReset} fullWidth sx={{ mt: 3 }}>
                Import Another File
              </Button>
            </Box>
          )}
        </Paper>

        <Box>
          <Card elevation={2} sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Supported CSV Formats
              </Typography>
              <Typography variant="body2" paragraph>
                The app accepts both the <strong>native Teams attendance report</strong> format
                and a custom CSV format:
              </Typography>
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Teams Native Format (downloaded from meeting chat):
              </Typography>
              <Box
                component="code"
                sx={{
                  display: 'block',
                  p: 1.5,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                  fontSize: '0.7rem',
                  overflowX: 'auto',
                  mb: 2,
                }}
              >
                1. Summary{'\n'}
                Meeting Title &lt;tab&gt; Class Name{'\n'}
                Start Time &lt;tab&gt; 1/15/2024, 9:00 AM{'\n'}
                ...{'\n'}
                2. Participants{'\n'}
                Full Name &lt;tab&gt; First Join &lt;tab&gt; Last Leave ...
              </Box>
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Custom CSV Format:
              </Typography>
              <Box
                component="code"
                sx={{
                  display: 'block',
                  p: 1.5,
                  bgcolor: 'grey.100',
                  borderRadius: 1,
                  fontSize: '0.7rem',
                  overflowX: 'auto',
                }}
              >
                meeting_id, meeting_title, meeting_start,{'\n'}
                meeting_end, student_email, student_name,{'\n'}
                join_time, leave_time, duration_minutes
              </Box>
            </CardContent>
          </Card>

          <Card elevation={2}>
            <CardContent>
              <Typography variant="h6" gutterBottom color="info.main">
                Tips
              </Typography>
              <Box component="ul" sx={{ pl: 2 }}>
                <Typography component="li" variant="body2" paragraph>
                  Duplicate records are automatically skipped
                </Typography>
                <Typography component="li" variant="body2" paragraph>
                  Students and meetings are created automatically from the CSV
                </Typography>
                <Typography component="li" variant="body2" paragraph>
                  Late = joined 10+ minutes after start; Partial = attended less than 30 minutes
                </Typography>
                <Typography component="li" variant="body2" paragraph>
                  The folder watcher only processes files that look like Teams attendance reports
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Box>
  );
};

export default SyncPage;
