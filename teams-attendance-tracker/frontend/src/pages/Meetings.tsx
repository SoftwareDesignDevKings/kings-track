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
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Visibility as VisibilityIcon } from '@mui/icons-material';
import { apiService } from '../services/api';
import { Meeting } from '../types';
import { format } from 'date-fns';

const Meetings: React.FC = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [classCodes, setClassCodes] = useState<string[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadClassCodes();
  }, []);

  useEffect(() => {
    loadMeetings();
  }, [selectedClass]);

  const loadClassCodes = async () => {
    try {
      const codes = await apiService.getClassCodes();
      setClassCodes(codes);
    } catch (err) {
      // Non-critical, just won't show filter
    }
  };

  const loadMeetings = async () => {
    try {
      setLoading(true);
      setError(null);
      let data;
      if (selectedClass) {
        data = await apiService.getMeetingsByClass(selectedClass);
      } else {
        data = await apiService.getMeetings(100, 0);
      }
      setMeetings(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  };

  const getMeetingStatus = (meeting: Meeting) => {
    const now = new Date();
    const start = new Date(meeting.start_time);
    const end = new Date(meeting.end_time);

    if (now < start) {
      return { label: 'Upcoming', color: 'primary' as const };
    } else if (now >= start && now <= end) {
      return { label: 'In Progress', color: 'success' as const };
    } else {
      return { label: 'Completed', color: 'default' as const };
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
      <Typography variant="h4" gutterBottom fontWeight="bold">
        Meetings
      </Typography>
      <Box display="flex" alignItems="center" gap={2} mb={2}>
        <Typography variant="body1" color="textSecondary">
          View all Teams meetings
        </Typography>
        {classCodes.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Filter by Class</InputLabel>
            <Select
              value={selectedClass}
              label="Filter by Class"
              onChange={(e) => setSelectedClass(e.target.value)}
            >
              <MenuItem value="">All Classes</MenuItem>
              {classCodes.map((code) => (
                <MenuItem key={code} value={code}>{code}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} elevation={2}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell><strong>Title</strong></TableCell>
              <TableCell><strong>Class</strong></TableCell>
              <TableCell><strong>Start Time</strong></TableCell>
              <TableCell><strong>End Time</strong></TableCell>
              <TableCell><strong>Status</strong></TableCell>
              <TableCell><strong>Actions</strong></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {meetings.length > 0 ? (
              meetings.map((meeting) => {
                const status = getMeetingStatus(meeting);
                return (
                  <TableRow key={meeting.id} hover>
                    <TableCell>{meeting.title || 'Untitled Meeting'}</TableCell>
                    <TableCell>
                      {meeting.class_code ? (
                        <Chip label={meeting.class_code} size="small" color="secondary" variant="outlined" />
                      ) : (
                        <Typography variant="body2" color="textSecondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {format(new Date(meeting.start_time), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      {format(new Date(meeting.end_time), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <Chip label={status.label} color={status.color} size="small" />
                    </TableCell>
                    <TableCell>
                      <Tooltip title="View Attendance">
                        <IconButton size="small" color="primary">
                          <VisibilityIcon />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography color="textSecondary" py={4}>
                    {selectedClass
                      ? `No meetings found for class ${selectedClass}.`
                      : 'No meetings found. Import attendance files to get started.'}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default Meetings;
