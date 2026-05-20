import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  Stack,
  Button,
  Collapse,
  IconButton,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  School as SchoolIcon,
  Sync as SyncIcon,
} from '@mui/icons-material';
import { apiService } from '../services/api';
import { Meeting } from '../types';
import { format } from 'date-fns';

interface ClassInfo {
  class_code: string;
  sub_classes: string[];
  student_count: string;
  last_synced: string;
}

interface MeetingAttendanceDetail {
  meeting: Meeting;
  attendance: Array<{
    student_name: string;
    student_email: string;
    status: string;
    duration_minutes: number;
    join_time: string;
  }>;
  absent: Array<{
    student_id: string;
    name: string;
    email: string;
  }>;
  summary: {
    total_enrolled: number;
    present: number;
    late: number;
    partial: number;
    absent: number;
  };
}

const Classes: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [meetings, setMeetings] = useState<Record<string, Meeting[]>>({});
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [expandedMeeting, setExpandedMeeting] = useState<string | null>(null);
  const [meetingDetail, setMeetingDetail] = useState<MeetingAttendanceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const status = await apiService.getCanvasStatus();
      setClasses(status.synced_classes || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load class data');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    try {
      setSyncing(true);
      setSyncMessage(null);
      const result = await apiService.syncAllCanvasRosters();
      setSyncMessage(result.message);
      await loadData();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to sync');
    } finally {
      setSyncing(false);
    }
  };

  const handleExpandClass = async (classCode: string) => {
    if (expandedClass === classCode) {
      setExpandedClass(null);
      return;
    }

    setExpandedClass(classCode);
    setExpandedMeeting(null);
    setMeetingDetail(null);

    // Load meetings for this class if not already loaded
    if (!meetings[classCode]) {
      try {
        const data = await apiService.getMeetingsByClass(classCode);
        setMeetings(prev => ({ ...prev, [classCode]: data }));
      } catch (err) {
        console.error('Failed to load meetings for class:', err);
      }
    }
  };

  const handleExpandMeeting = async (meetingId: string) => {
    if (expandedMeeting === meetingId) {
      setExpandedMeeting(null);
      setMeetingDetail(null);
      return;
    }

    setExpandedMeeting(meetingId);
    setDetailLoading(true);

    try {
      const detail = await apiService.getMeetingAttendanceWithAbsences(meetingId);
      setMeetingDetail(detail);
    } catch (err) {
      console.error('Failed to load meeting attendance:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present': return 'success';
      case 'late': return 'warning';
      case 'partial': return 'info';
      case 'absent': return 'error';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Typography variant="h4" gutterBottom fontWeight="bold">
            Classes
          </Typography>
          <Typography variant="body1" color="textSecondary">
            View attendance by class with Canvas roster cross-reference
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="secondary"
          startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
          onClick={handleSyncAll}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Sync Rosters'}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {syncMessage && (
        <Alert severity="success" onClose={() => setSyncMessage(null)} sx={{ mb: 2 }}>
          {syncMessage}
        </Alert>
      )}

      {classes.length === 0 ? (
        <Alert severity="info">
          No classes synced yet. Go to Sync Data and click "Sync All Class Rosters" to pull student rosters from Canvas.
        </Alert>
      ) : (
        <Stack spacing={2}>
          {classes.map((cls) => (
            <Paper key={cls.class_code} elevation={2}>
              {/* Class header */}
              <Box
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'grey.50' },
                }}
                onClick={() => handleExpandClass(cls.class_code)}
              >
                <Box display="flex" alignItems="center" gap={2}>
                  <SchoolIcon color="secondary" />
                  <Box>
                    <Typography variant="h6">
                      {cls.class_code}
                      {cls.sub_classes && cls.sub_classes.length > 1 && (
                        <Typography component="span" variant="body2" color="textSecondary" sx={{ ml: 1 }}>
                          ({cls.sub_classes.join(' + ')})
                        </Typography>
                      )}
                    </Typography>
                    <Typography variant="body2" color="textSecondary">
                      {cls.student_count} enrolled students
                      {cls.last_synced && ` | Last synced: ${format(new Date(cls.last_synced), 'MMM dd, HH:mm')}`}
                    </Typography>
                  </Box>
                </Box>
                <IconButton>
                  {expandedClass === cls.class_code ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                </IconButton>
              </Box>

              {/* Expanded class: show meetings */}
              <Collapse in={expandedClass === cls.class_code}>
                <Box sx={{ px: 2, pb: 2 }}>
                  {meetings[cls.class_code]?.length > 0 ? (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell><strong>Meeting</strong></TableCell>
                            <TableCell><strong>Date</strong></TableCell>
                            <TableCell><strong>Details</strong></TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {meetings[cls.class_code].map((meeting) => (
                            <React.Fragment key={meeting.id}>
                              <TableRow
                                hover
                                sx={{ cursor: 'pointer' }}
                                onClick={() => handleExpandMeeting(meeting.id)}
                              >
                                <TableCell>{meeting.title || 'Untitled'}</TableCell>
                                <TableCell>
                                  {format(new Date(meeting.start_time), 'MMM dd, yyyy HH:mm')}
                                </TableCell>
                                <TableCell>
                                  <Chip
                                    label={expandedMeeting === meeting.id ? 'Hide' : 'View Attendance'}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                  />
                                </TableCell>
                              </TableRow>

                              {/* Expanded meeting: show attendance detail */}
                              {expandedMeeting === meeting.id && (
                                <TableRow>
                                  <TableCell colSpan={3} sx={{ p: 0 }}>
                                    <Collapse in={true}>
                                      <Box sx={{ p: 2, bgcolor: 'grey.50' }}>
                                        {detailLoading ? (
                                          <Box display="flex" justifyContent="center" py={2}>
                                            <CircularProgress size={24} />
                                          </Box>
                                        ) : meetingDetail ? (
                                          <Box>
                                            {/* Summary cards */}
                                            <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
                                              <Card variant="outlined" sx={{ minWidth: 100 }}>
                                                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                                                  <Typography variant="caption" color="textSecondary">Enrolled</Typography>
                                                  <Typography variant="h6">{meetingDetail.summary.total_enrolled}</Typography>
                                                </CardContent>
                                              </Card>
                                              <Card variant="outlined" sx={{ minWidth: 100 }}>
                                                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                                                  <Typography variant="caption" color="success.main">Present</Typography>
                                                  <Typography variant="h6" color="success.main">{meetingDetail.summary.present}</Typography>
                                                </CardContent>
                                              </Card>
                                              <Card variant="outlined" sx={{ minWidth: 100 }}>
                                                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                                                  <Typography variant="caption" color="warning.main">Late</Typography>
                                                  <Typography variant="h6" color="warning.main">{meetingDetail.summary.late}</Typography>
                                                </CardContent>
                                              </Card>
                                              <Card variant="outlined" sx={{ minWidth: 100 }}>
                                                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                                                  <Typography variant="caption" color="info.main">Partial</Typography>
                                                  <Typography variant="h6" color="info.main">{meetingDetail.summary.partial}</Typography>
                                                </CardContent>
                                              </Card>
                                              <Card variant="outlined" sx={{ minWidth: 100 }}>
                                                <CardContent sx={{ py: 1, px: 2, '&:last-child': { pb: 1 } }}>
                                                  <Typography variant="caption" color="error.main">Absent</Typography>
                                                  <Typography variant="h6" color="error.main">{meetingDetail.summary.absent}</Typography>
                                                </CardContent>
                                              </Card>
                                            </Stack>

                                            {/* Attended students */}
                                            <Typography variant="subtitle2" gutterBottom>
                                              Attended ({meetingDetail.attendance.length})
                                            </Typography>
                                            <TableContainer sx={{ mb: 2 }}>
                                              <Table size="small">
                                                <TableHead>
                                                  <TableRow>
                                                    <TableCell>Name</TableCell>
                                                    <TableCell>Email</TableCell>
                                                    <TableCell>Status</TableCell>
                                                    <TableCell>Duration</TableCell>
                                                  </TableRow>
                                                </TableHead>
                                                <TableBody>
                                                  {meetingDetail.attendance.map((record: any, idx: number) => (
                                                    <TableRow key={idx}>
                                                      <TableCell>{record.student_name}</TableCell>
                                                      <TableCell sx={{ fontSize: '0.75rem' }}>{record.student_email}</TableCell>
                                                      <TableCell>
                                                        <Chip
                                                          label={record.status}
                                                          size="small"
                                                          color={getStatusColor(record.status) as any}
                                                        />
                                                      </TableCell>
                                                      <TableCell>{record.duration_minutes}m</TableCell>
                                                    </TableRow>
                                                  ))}
                                                </TableBody>
                                              </Table>
                                            </TableContainer>

                                            {/* Absent students */}
                                            {meetingDetail.absent.length > 0 && (
                                              <>
                                                <Typography variant="subtitle2" gutterBottom color="error.main">
                                                  Absent ({meetingDetail.absent.length}) — On Canvas roster but did not attend
                                                </Typography>
                                                <TableContainer>
                                                  <Table size="small">
                                                    <TableHead>
                                                      <TableRow>
                                                        <TableCell>Name</TableCell>
                                                        <TableCell>Email</TableCell>
                                                        <TableCell>Status</TableCell>
                                                      </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                      {meetingDetail.absent.map((student, idx) => (
                                                        <TableRow key={idx}>
                                                          <TableCell>{student.name}</TableCell>
                                                          <TableCell sx={{ fontSize: '0.75rem' }}>{student.email}</TableCell>
                                                          <TableCell>
                                                            <Chip label="Absent" size="small" color="error" />
                                                          </TableCell>
                                                        </TableRow>
                                                      ))}
                                                    </TableBody>
                                                  </Table>
                                                </TableContainer>
                                              </>
                                            )}

                                            {meetingDetail.absent.length === 0 && meetingDetail.attendance.length > 0 && (
                                              <Alert severity="success" variant="outlined" sx={{ mt: 1 }}>
                                                All enrolled students attended this meeting.
                                              </Alert>
                                            )}
                                          </Box>
                                        ) : null}
                                      </Box>
                                    </Collapse>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Typography variant="body2" color="textSecondary" sx={{ py: 2 }}>
                      No meetings found for this class yet.
                    </Typography>
                  )}
                </Box>
              </Collapse>
            </Paper>
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default Classes;
