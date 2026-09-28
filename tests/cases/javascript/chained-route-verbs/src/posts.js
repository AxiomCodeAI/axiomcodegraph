'use strict';
const express = require('express');

function listPosts(req, res) { res.json([]); }
function newPost(req, res) { res.send('form'); }
function createPost(req, res) { res.status(201).end(); }
function showPost(req, res) { res.json({}); }
function updatePost(req, res) { res.end(); }
function listTags(req, res) { res.json([]); }
function showTag(req, res) { res.json({}); }
function renameTag(req, res) { res.end(); }

const router = express.Router();
router.get('/posts', listPosts)
  .get('/posts/new', newPost)
  .post('/posts', createPost);
router.route('/posts/:id')
  .get(showPost)
  .put(updatePost);
router.get('/tags', listTags);
router.route('/tags/:id').get(showTag).put(renameTag);

module.exports = router;
