// router.delete('/delete/:id', async(req, res) => {
//     try {
//         const eliminated = await Post.remove({ _id: req.params.id });
//         res.json(eliminated);
//     } catch (err) {
//         res.json({ message: err });
//         console.log("Hola");
//     }
// });

// router.get('/:name', async(req, res) => {
//     try {
//         const post = await Post.find({ nombre: req.params.name });
//         res.json(post);
//     } catch (err) {
//         res.json(err);
//     }
// });