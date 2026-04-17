#!/usr/bin/env python
# jadeR.py -- Blind source separation of real signals
# Version 1.8
# Copyright 2005, Jean-Francois Cardoso (Original MATLAB code)
# Copyright 2007, Gabriel J.L. Beckers (NumPy translation)
# GNU GPL v3 — see original header for full license text
#
# Ported into Clarity Loop from the Heart-Rate-Detection reference (Python 2 → 3).
# NOTE: uses numpy.matrix which is deprecated in NumPy 2.x but still functional.

from numpy import (abs, append, arange, arctan2, argsort, array, concatenate,
                   cos, diag, dot, eye, float64, matrix, multiply, ndarray,
                   newaxis, sign, sin, sqrt, zeros)
from numpy.linalg import eig, pinv


def jadeR(X):
    """
    Blind separation of real signals with JADE (ICA).

    Parameters
    ----------
    X : ndarray, shape (n_sensors, n_samples)

    Returns
    -------
    B : matrix, shape (n, n)  — separating matrix.  Sources = B @ X.
    """
    X = matrix(X.astype(float64))
    [n, T] = X.shape
    m = n
    X -= X.mean(1)

    # Whitening via PCA
    [D, U] = eig((X * X.T) / float(T))
    k = D.argsort()
    Ds = D[k]
    PCs = arange(n - 1, n - m - 1, -1)
    B = U[:, k[PCs]].T
    scales = sqrt(Ds[PCs])
    B = diag(1. / scales) * B
    X = B * X
    del U, D, Ds, k, PCs, scales

    # Cumulant matrices
    X = X.T
    dimsymm = (m * (m + 1)) / 2
    nbcm = dimsymm
    CM = matrix(zeros([m, m * int(nbcm)], dtype=float64))
    R = matrix(eye(m, dtype=float64))
    Qij = matrix(zeros([m, m], dtype=float64))
    Xim = zeros(m, dtype=float64)
    Xijm = zeros(m, dtype=float64)
    Range = arange(m)

    for im in range(m):
        Xim = X[:, im]
        Xijm = multiply(Xim, Xim)
        Qij = multiply(Xijm, X).T * X / float(T) - R - 2 * dot(R[:, im], R[:, im].T)
        CM[:, Range] = Qij
        Range = Range + m
        for jm in range(im):
            Xijm = multiply(Xim, X[:, jm])
            Qij = (sqrt(2) * multiply(Xijm, X).T * X / float(T)
                   - R[:, im] * R[:, jm].T - R[:, jm] * R[:, im].T)
            CM[:, Range] = Qij
            Range = Range + m

    # Joint diagonalisation
    V = matrix(eye(m, dtype=float64))
    Diag = zeros(m, dtype=float64)
    On = 0.0
    Range = arange(m)
    for im in range(int(nbcm)):
        Diag = diag(CM[:, Range])
        On = On + (Diag * Diag).sum(axis=0)
        Range = Range + m
    Off = (multiply(CM, CM).sum(axis=0)).sum(axis=0) - On
    seuil = 1.0e-6 / sqrt(T)
    encore = True
    sweep = 0
    updates = 0
    g = zeros([2, int(nbcm)], dtype=float64)
    gg = zeros([2, 2], dtype=float64)
    G = zeros([2, 2], dtype=float64)

    while encore:
        encore = False
        sweep += 1
        upds = 0
        Vkeep = V
        for p in range(m - 1):
            for q in range(p + 1, m):
                Ip = arange(p, m * int(nbcm), m)
                Iq = arange(q, m * int(nbcm), m)
                g = concatenate([CM[p, Ip] - CM[q, Iq], CM[p, Iq] + CM[q, Ip]])
                gg = dot(g, g.T)
                ton = gg[0, 0] - gg[1, 1]
                toff = gg[0, 1] + gg[1, 0]
                theta = 0.5 * arctan2(toff, ton + sqrt(ton * ton + toff * toff))
                Gain = (sqrt(ton * ton + toff * toff) - ton) / 4.0
                if abs(theta) > seuil:
                    encore = True
                    upds += 1
                    c = cos(theta)
                    s = sin(theta)
                    G = matrix([[c, -s], [s, c]])
                    pair = array([p, q])
                    V[:, pair] = V[:, pair] * G
                    CM[pair, :] = G.T * CM[pair, :]
                    CM[:, concatenate([Ip, Iq])] = append(
                        c * CM[:, Ip] + s * CM[:, Iq],
                        -s * CM[:, Ip] + c * CM[:, Iq],
                        axis=1,
                    )
                    On += Gain
                    Off -= Gain
        updates += upds

    B = V.T * B
    A = pinv(B)
    keys = array(argsort(multiply(A, A).sum(axis=0)[0]))[0]
    B = B[keys, :]
    B = B[::-1, :]
    b = B[:, 0]
    signs = array(sign(sign(b) + 0.1).T)[0]
    B = diag(signs) * B
    return B


def run(X):
    """Apply JADE ICA and return separated components (T × n)."""
    B = jadeR(X)
    Y = B * matrix(X)
    return Y.T
