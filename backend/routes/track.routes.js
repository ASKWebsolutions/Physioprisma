'use strict';

const express = require('express');

const User = require('../models/User.model');
const Enrollment = require('../models/Enrollment.model');
const { asyncHandler, ApiError } = require('../middleware/error');

const router = express.Router();

/**
 * GET /api/track/:rollNo - public "Track Your Record" lookup on the student
 * portal. Deliberately limited: name, roll number, courses and progress only.
 * Contact details, login activity and messages stay admin-only.
 */
router.get(
  '/:rollNo',
  asyncHandler(async (req, res) => {
    let rollNo = String(req.params.rollNo || '').trim().toUpperCase();
    if (!rollNo || rollNo.length > 20) throw ApiError.badRequest('Please enter a roll number');
    rollNo = rollNo.replace(/[^A-Z0-9-]/g, '');
    const student = await User.findOne({ rollNo, role: 'student' }).select('name rollNo role status joinedAt');
    if (!student) throw ApiError.notFound('No record found for roll number ' + rollNo);

    const enrollments = await Enrollment.find({ user: student._id })
      .populate('course', 'title slug image')
      .sort({ createdAt: -1 });

    const courses = enrollments
      .filter((e) => e.course)
      .map((e) => ({
        title: e.course.title,
        slug: e.course.slug,
        image: e.course && e.course.image ? e.course.image.url || '' : '',
        progress: e.progress || 0,
        status: e.status,
        enrolledAt: e.createdAt,
        completedAt: e.completedAt,
      }));

    const completed = courses.filter((c) => c.status === 'completed').length;

    res.json({
      ok: true,
      student: {
        rollNo: student.rollNo,
        name: student.name,
        status: student.status,
        joinedAt: student.joinedAt,
      },
      courses,
      summary: {
        courses: courses.length,
        completed,
        inProgress: courses.length - completed,
        averageProgress: courses.length
          ? Math.round(courses.reduce((sum, c) => sum + (c.progress || 0), 0) / courses.length)
          : 0,
      },
    });
  })
);

module.exports = router;
